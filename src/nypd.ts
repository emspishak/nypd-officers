import {Scheduler} from 'async-scheduler';
import {writeFile} from 'fs';
import fetch from 'node-fetch';
import {
  Date,
  Ethnicity,
  Month,
  Name,
  Officer,
  Rank,
  RankHistoryEntry} from './officer';
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

let officerCount = 0;

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
    const name = findName(officer);
    const fetches = [
      fetchData(1, taxId, token), // Officer profile data
      fetchData(7, taxId, token), // Rank/shield history
    ];
    return Promise.all(fetches)
        .then((results) => handleOfficer(results, taxId, name), (err) => {
          console.log(`ERROR: error fetching tax ID ${taxId} - ${name}`, err);
          return null;
        });
  });
}

function findName(officer: {Columns: any[]}): string {
  const nameCol = officer.Columns.find(
      (column) => column.Id === '85ed4926-7d4c-4771-a921-f5fe84ac2acc');
  return nameCol ? nameCol.Value : 'name_missing';
}

function fetchData(dataNum: number, taxId: number, token: string):
    Promise<any> {
  return authFetch(
      `https://oip.nypdonline.org/api/reports/${dataNum}/datasource/list`,
      token, {
        method: 'POST',
        body: '{filters: [{key: "@TAXID", label: "TAXID", values: ["' +
            taxId + '"]}]}',
        headers: {
          'Content-Type': 'application/json',
        },
      });
}

/** Converts an officer's JSON into an Officer object. */
function handleOfficer(results: any[], taxId: number, debugName: string):
   Officer | null {
  const officerWrap = results[0];
  const rankHistory: RankHistoryEntry[] = parseRankHistory(results[1], taxId);

  if (officerWrap.length != 1) {
    console.log(
        `ERROR: ${officerWrap.length} elements in ${officerWrap} for ${taxId} =
        ${debugName}`);
    return null;
  }
  const officer = officerWrap[0];

  let rank: Rank | null = null;
  let appointmentDate: Date | null = null;
  let command: string | null = null;
  let assignmentDate: Date | null = null;
  let ethnicity: Ethnicity | null = null;
  let shieldNumber: number | undefined = undefined;

  officer.Items.forEach((item: any) => {
    const value: any = item.Value;
    switch (item.Id) {
      case 'a2fded09-5439-4b17-9da8-81a5643ec3e8':
        rank = parseRank(value);
        break;
      case '20e891ce-1dcf-4d46-9185-075336788d65':
        appointmentDate = parseDate(value);
        break;
      case '1692f3bf-ed70-4b4a-96a1-9131427e4de9':
        command = value;
        break;
      case '8a2bcb6f-e064-44f4-8a58-8f38aa6ebae9':
        assignmentDate = parseDate(value);
        break;
      case '0ec90f94-b636-474c-bec7-ab04e73540ed':
        // Ethnicity seems to have a bunch a spaces at the end.
        ethnicity = parseEthnicity(value.trim());
        break;
      case '42f74dfc-ee54-4b25-822f-415615d22aa9':
        shieldNumber = parseShieldNumber(value);
        break;
      default:
        console.log(`unknown field for tax ID ${taxId}: ${item.Id} - ${value}`);
        break;
    }
  });

  if (rank === null) {
    console.log(`ERROR: missing rank for tax ID ${taxId}`);
    rank = Rank.ERROR_UNKNOWN;
  }
  if (appointmentDate === null) {
    console.log(`ERROR: missing appointment date for tax ID ${taxId}`);
    appointmentDate = unknownDate;
  }
  if (command === null) {
    console.log(`ERROR: missing command for tax ID ${taxId}`);
    command = 'ERROR_UNKNOWN';
  }
  if (assignmentDate === null) {
    console.log(`ERROR: missing assignment date for tax ID ${taxId}`);
    assignmentDate = unknownDate;
  }
  if (ethnicity === null) {
    console.log(`ERROR: missing ethnicity for tax ID ${taxId}`);
    ethnicity = Ethnicity.ERROR_UNKNOWN;
  }

  const name: Name = parseName(officer.Label);

  officerCount++;
  if (officerCount % 100 === 0) {
    console.log(
        `processed ${officerCount} officers: ${name.first} ${name.last}`);
  }

  return {
    taxId,
    name,
    rank,
    appointmentDate,
    command,
    assignmentDate,
    ethnicity,
    shieldNumber,
    rankHistory,
  };
}

function parseRank(rank: string): Rank | null {
  switch (rank) {
    case 'POLICE OFFICER':
    case 'POLICE_OFFICER':
      return Rank.POLICE_OFFICER;
    case 'DETECTIVE 3RD GRADE':
      return Rank.DETECTIVE_3;
    case 'DETECTIVE 2ND GRADE':
      return Rank.DETECTIVE_2;
    case 'DETECTIVE 1ST GRADE':
      return Rank.DETECTIVE_1;
    case 'DETECTIVE':
      return Rank.DETECTIVE;
    case 'DETECTIVE SPECIALIST':
      return Rank.DETECTIVE_SPECIALIST;
    case 'SGT SPECIAL ASSIGN':
      return Rank.SERGEANT_SPECIAL;
    case 'SGT DET SQUAD':
      return Rank.SERGEANT_DET;
    case 'SERGEANT':
      return Rank.SERGEANT;
    case 'LT DET COMMANDER':
      return Rank.LIEUTENANT_DET_COMMANDER;
    case 'LT SPECIAL ASSIGN':
      return Rank.LIEUTENANT_SPECIAL;
    case 'LIEUTENANT':
      return Rank.LIEUTENANT;
    case 'CAPTAIN':
      return Rank.CAPTAIN;
    case 'DEPUTY INSPECTOR':
      return Rank.DEPUTY_INSPECTOR;
    case 'INSPECTOR':
      return Rank.INSPECTOR;
    case 'DEPUTY CHIEF':
      return Rank.DEPUTY_CHIEF;
    case 'ASSISTANT CHIEF':
      return Rank.ASSISTANT_CHIEF;
    case 'CHIEF OF COMMUNITY AFFAIRS':
      return Rank.CHIEF_COMMUNITY_AFFAIRS;
    case 'CHIEF OF CRIME CNTRL STRATEGIES':
      return Rank.CHIEF_CRIME_CNTRL_STRATEGIES;
    case 'CHIEF OF DEPARTMENT':
      return Rank.CHIEF_DEPARTMENT;
    case 'CHIEF OF DETECTIVES':
      return Rank.CHIEF_DETECTIVES;
    case 'CHIEF OF HOUSING':
      return Rank.CHIEF_HOUSING;
    case 'CHIEF OF INTELLIGENCE':
      return Rank.CHIEF_INTELLIGENCE;
    case 'CHIEF OF LABOR REL':
      return Rank.CHIEF_LABOR_REL;
    case 'CHIEF OF OPERATIONS':
      return Rank.CHIEF_OPERATIONS;
    case 'CHIEF OF PATROL':
      return Rank.CHIEF_PATROL;
    case 'CHIEF OF PERSONNEL':
      return Rank.CHIEF_PERSONNEL;
    case 'CHIEF OF SPECIAL OPERATIONS':
      return Rank.CHIEF_SPECIAL_OPERATIONS;
    case 'CHIEF OF TRAINING':
      return Rank.CHIEF_TRAINING;
    case 'CHIEF OF TRANSIT':
      return Rank.CHIEF_TRANSIT;
    case 'CHIEF OF TRANSPORTATION':
      return Rank.CHIEF_TRANSPORTATION;
    default:
      console.log(`ERROR: unknown rank: ${rank}`);
      return null;
  }
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

function parseEthnicity(ethnicity: string): Ethnicity {
  switch (ethnicity) {
    case 'ASIAN':
      return Ethnicity.ASIAN;
    case 'BLACK':
      return Ethnicity.BLACK;
    case 'HISPANIC':
      return Ethnicity.HISPANIC;
    case 'NATIVE AMERICAN':
      return Ethnicity.NATIVE_AMERICAN;
    case 'WHITE':
      return Ethnicity.WHITE;
    default:
      console.log(`ERROR: unknown ethnicity ${ethnicity}`);
      return Ethnicity.ERROR_UNKNOWN;
  }
}

function parseShieldNumber(shield: string): number | undefined {
  // No shield number is represented as ' '.
  const trimmed = shield.trim();
  if (trimmed) {
    return parseInt(trimmed);
  }
  return undefined;
}

function parseRankHistory(json: any[], taxId: number): RankHistoryEntry[] {
  if (json.length < 1) {
    console.log(`ERROR: no rank history for ${taxId}`);
  }
  const ranks: RankHistoryEntry[] = json.map((e: any) => {
    let effectiveDate: Date | null = null;
    let rank: Rank | null = null;
    let shieldNumber: number | undefined = undefined;

    e.Columns.forEach((col: any) => {
      const value = col.Value;
      switch (col.Id) {
        case '74cead80-e1af-4aa3-9fa0-1dbf30bdf55b':
          effectiveDate = parseDate(value);
          break;
        case '31d512d9-6bac-45d4-8ab2-cbd951e3f216':
          // This rank sometimes has whitespace at the end.
          rank = parseRank(value.trim());
          break;
        case 'a5a69be2-3fe2-41d6-b174-b6c623cbe702':
          shieldNumber = parseShieldNumber(value);
          break;
        default:
          console.log(
              `ERROR: unknown rank history field for ${taxId}: ${col.Id} -
              ${value}`);
      }
    });

    if (effectiveDate === null) {
      console.log(`ERROR: no effective date for ${taxId} -> ${rank}`);
      effectiveDate = unknownDate;
    }
    if (rank === null) {
      console.log(
          `ERROR: no rank for ${taxId} on ${JSON.stringify(effectiveDate)}`);
      rank = Rank.ERROR_UNKNOWN;
    }

    return {
      effectiveDate,
      rank,
      shieldNumber,
    };
  });
  ranks.sort((rank1, rank2) => {
    return compareDate(rank1.effectiveDate, rank2.effectiveDate);
  });
  return ranks;
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

function compareDate(date1: Date, date2: Date): number {
  if (date1.year !== date2.year) {
    return date1.year - date2.year;
  } else if (date1.month !== date2.month) {
    return date1.month - date2.month;
  } else {
    return date1.day - date2.day;
  }
}
