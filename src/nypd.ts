import {Scheduler} from 'async-scheduler';
import {writeFile} from 'fs';
import fetch from 'node-fetch';
import {Date, Month, Name, Officer, Rank} from './officer';
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

const unknownDate = {
  year: -1,
  month: Month.ERROR_UNKNOWN,
  day: -1,
};

// Some auth setup, requests often fail (rate limiting?) without this.
fetch('https://oip.nypdonline.org/oauth2/token', {
  // This client ID appears to be constant for everyone.
  'body': 'grant_type=client_credentials&' +
    'scope=clientId%3D435e66dd-eca9-47fc-be6b-091858a1ca7d',
  'method': 'POST',
}).then((res) => res.json()).then(fetchOfficers).then(write);

function write(officers: (Officer | null)[]) {
  const filtered: Officer[] = [];
  officers.forEach((nullable) => {
    if (nullable !== null) {
      filtered.push(nullable);
    }
  });
  const officersString = JSON.stringify(filtered);
  writeFile('officers.json', officersString, (err) => {
    if (err) {
      throw err;
    }
  });
}

/** Fetch the top level list of officers. */
function fetchOfficers(auth: any): Promise<(Officer | null)[]> {
  const token: string = auth.access_token;
  const promises: Promise<(Officer | null)[]>[] = [];
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    promises.push(fetchPage(letter, 1, token)
        .then((res) => fetchAllOfficers(res, letter, token), (err) => {
          console.log(`ERROR: error fetching page 1 of ${letter}`, err);
          return [];
        }));
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
    Promise<(Officer | null)[]> {
  const totalOfficers: number = json.Total;
  const pages = Math.ceil(totalOfficers / 100);

  const promises: Promise<Promise<Officer | null>[]>[] =
      [Promise.resolve(handleOfficers(json, token))];
  if (!argv.sample) {
    for (let i = 2; i <= pages; i++) {
      promises.push(
          fetchPage(letter, i, token)
              .then((json) => handleOfficers(json, token), (err) => {
                console.log(
                    `ERROR: error fetching page ${i} of ${letter}`,
                    err);
                return Promise.resolve(Promise.resolve([]));
              }));
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
function handleOfficers(json: any, token: string): Promise<Officer | null>[] {
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
        .then((officers) => handleOfficer(officers, taxId), (err) => {
          console.log(`ERROR: error fetching tax ID ${taxId}`, err);
          return null;
        });
  });
}

/** Converts an officer's JSON into an Officer object. */
function handleOfficer(officerWrap: any, taxId: number): Officer | null {
  if (officerWrap.length != 1) {
    console.log(
        `${officerWrap.length} elements in ${officerWrap} for ${taxId}`);
    return null;
  }
  const officer = officerWrap[0];

  let rank: Rank = Rank.ERROR_UNKNOWN;
  let appointmentDate: Date = unknownDate;
  let command: string = 'ERROR_UNKNOWN';

  officer.Items.forEach((item: any) => {
    const value: any = item.Value;
    switch (item.Id) {
      case 'a2fded09-5439-4b17-9da8-81a5643ec3e8':
        switch (value) {
          case 'POLICE OFFICER':
          case 'POLICE_OFFICER':
            rank = Rank.POLICE_OFFICER;
            break;
          case 'DETECTIVE 3RD GRADE':
            rank = Rank.DETECTIVE_3;
            break;
          case 'DETECTIVE 2ND GRADE':
            rank = Rank.DETECTIVE_2;
            break;
          case 'DETECTIVE 1ST GRADE':
            rank = Rank.DETECTIVE_1;
            break;
          case 'DETECTIVE SPECIALIST':
            rank = Rank.DETECTIVE_SPECIALIST;
            break;
          case 'SGT SPECIAL ASSIGN':
            rank = Rank.SERGEANT_SPECIAL;
            break;
          case 'SGT DET SQUAD':
            rank = Rank.SERGEANT_DET;
            break;
          case 'SERGEANT':
            rank = Rank.SERGEANT;
            break;
          case 'LT DET COMMANDER':
            rank = Rank.LIEUTENANT_DET_COMMANDER;
            break;
          case 'LT SPECIAL ASSIGN':
            rank = Rank.LIEUTENANT_SPECIAL;
            break;
          case 'LIEUTENANT':
            rank = Rank.LIEUTENANT;
            break;
          case 'CAPTAIN':
            rank = Rank.CAPTAIN;
            break;
          case 'DEPUTY INSPECTOR':
            rank = Rank.DEPUTY_INSPECTOR;
            break;
          case 'INSPECTOR':
            rank = Rank.INSPECTOR;
            break;
          case 'DEPUTY CHIEF':
            rank = Rank.DEPUTY_CHIEF;
            break;
          case 'ASSISTANT CHIEF':
            rank = Rank.ASSISTANT_CHIEF;
            break;
          case 'CHIEF OF COMMUNITY AFFAIRS':
            rank = Rank.CHIEF_COMMUNITY_AFFAIRS;
            break;
          case 'CHIEF OF CRIME CNTRL STRATEGIES':
            rank = Rank.CHIEF_CRIME_CNTRL_STRATEGIES;
            break;
          case 'CHIEF OF DEPARTMENT':
            rank = Rank.CHIEF_DEPARTMENT;
            break;
          case 'CHIEF OF DETECTIVES':
            rank = Rank.CHIEF_DETECTIVES;
            break;
          case 'CHIEF OF HOUSING':
            rank = Rank.CHIEF_HOUSING;
            break;
          case 'CHIEF OF INTELLIGENCE':
            rank = Rank.CHIEF_INTELLIGENCE;
            break;
          case 'CHIEF OF LABOR REL':
            rank = Rank.CHIEF_LABOR_REL;
            break;
          case 'CHIEF OF OPERATIONS':
            rank = Rank.CHIEF_OPERATIONS;
            break;
          case 'CHIEF OF PATROL':
            rank = Rank.CHIEF_PATROL;
            break;
          case 'CHIEF OF PERSONNEL':
            rank = Rank.CHIEF_PERSONNEL;
            break;
          case 'CHIEF OF SPECIAL OPERATIONS':
            rank = Rank.CHIEF_SPECIAL_OPERATIONS;
            break;
          case 'CHIEF OF TRAINING':
            rank = Rank.CHIEF_TRAINING;
            break;
          case 'CHIEF OF TRANSIT':
            rank = Rank.CHIEF_TRANSIT;
            break;
          case 'CHIEF OF TRANSPORTATION':
            rank = Rank.CHIEF_TRANSPORTATION;
            break;
          default:
            console.log(`ERROR: unknown rank: ${value}`);
        }
        break;
      case '20e891ce-1dcf-4d46-9185-075336788d65':
        appointmentDate = parseDate(value);
        break;
      case '1692f3bf-ed70-4b4a-96a1-9131427e4de9':
        command = value;
        break;
    }
  });

  return {
    taxId,
    name: parseName(officer.Label),
    rank,
    appointmentDate,
    command,
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

function parseDate(date: string): Date {
  const dateRe = new RegExp('^(\\d{1,2})/(\\d{1,2})/(\\d{4}) 12:00:00 AM$');
  const match = date.match(dateRe);

  if (match == null) {
    console.log(`ERROR: could not parse date: ${date}`);
    return unknownDate;
  }

  return {
    year: parseYear(match[3]),
    month: parseMonth(match[1]),
    day: parseDay(match[2]),
  };
}

function parseYear(yearStr: string): number {
  const year: number = parseInt(yearStr);

  if (year < 1900 || year > 2100) {
    console.log(`ERROR: could not parse year ${yearStr}`);
    return -1;
  }

  return year;
}

function parseMonth(month: string): Month {
  switch (month) {
    case '1':
      return Month.JANUARY;
    case '2':
      return Month.FEBRUARY;
    case '3':
      return Month.MARCH;
    case '4':
      return Month.APRIL;
    case '5':
      return Month.MAY;
    case '6':
      return Month.JUNE;
    case '7':
      return Month.JULY;
    case '8':
      return Month.AUGUST;
    case '9':
      return Month.SEPTEMBER;
    case '10':
      return Month.OCTOBER;
    case '11':
      return Month.NOVEMBER;
    case '12':
      return Month.DECEMBER;
    default:
      console.log(`ERROR: unknown month: ${month}`);
      return Month.ERROR_UNKNOWN;
  }
}

function parseDay(dayStr: string): number {
  const day: number = parseInt(dayStr);

  if (day < 1 || day > 31) {
    console.log(`ERROR: could not parse day ${dayStr}`);
    return -1;
  }

  return day;
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
