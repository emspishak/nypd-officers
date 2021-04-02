import {Scheduler} from 'async-scheduler';
import {writeFile} from 'fs';
import fetch from 'node-fetch';
import {Officer, Name} from './officer';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
    .option('sample', {
      description: 'Only fetch a sample of records. This fetches the first ' +
        '10 records from each letter and is useful for testing since it runs ' +
        'much quicker.',
      type: 'boolean',
    })
    .help()
    .argv;

/**
 * Scrapes all NYPD officer information from https://nypdonline.org/link/2 into
 * a JSON object.
 */

// Set up a scheduler for web requests so this doesn't overload the server. It
// would probably work with more tasks, but needs experimentation to determine.
const scheduler = new Scheduler(10);

// Some auth setup, requests often fail (rate limiting?) without this.
fetch('https://oip.nypdonline.org/oauth2/token', {
  // This client ID appears to be constant for everyone.
  'body': 'grant_type=client_credentials&' +
    'scope=clientId%3D435e66dd-eca9-47fc-be6b-091858a1ca7d',
  'method': 'POST',
}).then((res) => res.json()).then(fetchOfficers).then(write);

function write(officers: Officer[]) {
  writeFile('officers.json', JSON.stringify(officers), (err) => {
    if (err) {
      throw err;
    }
  });
}

/** Fetch the top level list of officers. */
function fetchOfficers(auth: any): Promise<Officer[]> {
  const token: string = auth.access_token;
  const promises: Promise<Officer[]>[] = [];
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    promises.push(fetchPage(letter, 1, token)
        .then((res) => fetchAllOfficers(res, letter, token)));
  }
  return Promise.all(promises)
      .then((officers) => officers.reduce((acc, val) => acc.concat(val), []));
}

function fetchPage(letter: string, page: number, token: string): Promise<any> {
  return authFetch(
      'https://oip.nypdonline.org/api/reports/2/datasource/serverList?' +
          'aggregate=&filter=&group=&page=' +
          page +
          '&pageSize=100&platformFilters=%7B%22filters%22:%5B%7B' +
          '%22key%22:%22@SearchName%22,%22label%22:%22Search+Name%22,' +
          '%22values%22:%5B%22SEARCH_FILTER_VALUE%22%5D%7D,%7B' +
          '%22key%22:%22@LastNameFirstLetter%22,' +
          '%22label%22:%22Last+Name+First+Letter%22,' +
          '%22values%22:%5B%22' +
          letter +
          '%22%5D%7D%5D%7D&sort=',
      token);
}

function fetchAllOfficers(json: any, letter: string, token: string):
    Promise<Officer[]> {
  const totalOfficers: number = json.Total;
  const pages = Math.ceil(totalOfficers / 100);

  const promises: Promise<Promise<Officer>[]>[] =
      [Promise.resolve(handleOfficers(json, token))];
  if (!argv.sample) {
    for (let i = 2; i <= pages; i++) {
      promises.push(
          fetchPage(letter, i, token)
              .then((json) => handleOfficers(json, token)));
    }
  }
  // Convert Promise<Promise<Officer>[]>[] into Promise<Promise<Officer>[][]>
  return Promise.all(promises)
      // Flatten Promise<Promise<Officer>[][]> into Promise<Promise<Officer>[]>
      .then((officers) => officers.reduce((acc, val) => acc.concat(val), []))
      // Convert to Promise<Officer[]>
      .then((officers) => Promise.all(officers));
}

/** Fetches all data about every officer. */
function handleOfficers(json: any, token: string): Promise<Officer>[] {
  let data: any[] = json.Data;
  if (argv.sample) {
    data = data.slice(0, 10);
  }
  return data.map((officer) => {
    const taxId = parseInt(officer.RowValue);
    return authFetch(
        'https://oip.nypdonline.org/api/reports/1/datasource/list',
        token, {
          method: 'POST',
          body: '{filters: [{key: "@TAXID", label: "TAXID", values: ["' +
              taxId + '"]}]}',
          headers: {
            'Content-Type': 'application/json',
          },
        })
        .then((officers) => handleOfficer(officers, taxId));
  });
}

/** Converts an officer's JSON into an Officer object. */
function handleOfficer(officer: any, taxId: number): Officer {
  if (officer.length != 1) {
    throw new Error('multiple elements in ' + officer);
  }
  return {
    taxId,
    name: parseName(officer[0].Label),
  };
}

function parseName(name: string): Name {
  // The name format is "LAST, FIRST M", where M is an optional middle initial.
  // There is at least one first name with a space in it (SUMAN, MD ABDUL A) so
  // the first name match is lazy so that it consumes all of the first name
  // (including a space if there is one) but not the optional middle initial.
  const nameRe = new RegExp('^(.*), (.*?)( (.))?$');
  let match = name.trim().match(nameRe);

  if (match === null) {
    console.log(`ERROR: could not parse name: ${name}`);
    match = ['', 'error_missing', 'error_missing'];
  }

  return {
    first: match[2],
    // match[4] will be undefined if there is no middle initial, in which case
    // JSON.stringify won't include the property in the output.
    middleInitial: match[4],
    last: match[1],
  };
}

/** Fetches the given url with the given auth token and options. */
function authFetch(url: string, token: string, options?: any): Promise<any> {
  if (!options) {
    options = {};
  }
  if (!options.headers) {
    options.headers = {};
  }
  options.headers['Cookie'] = 'user=' + token;
  return scheduler.enqueue(() => fetch(url, options).then((res) => res.json()));
}
