import fetch from 'node-fetch';
import {Officer, Name} from './officer';

/**
 * Scrapes all NYPD officer information from https://nypdonline.org/link/2 into
 * a JSON object.
 */

// Some auth setup, requests often fail (rate limiting?) without this.
fetch('https://oip.nypdonline.org/oauth2/token', {
  // This client ID appears to be constant for everyone.
  'body': 'grant_type=client_credentials&' +
    'scope=clientId%3D435e66dd-eca9-47fc-be6b-091858a1ca7d',
  'method': 'POST',
}).then((res) => res.json()).then(fetchOfficers);

/** Fetch the top level list of officers. */
function fetchOfficers(auth: any) {
  const token = auth.access_token;
  return fetch('https://oip.nypdonline.org/api/reports/2/datasource/serverList?aggregate=&filter=&group=&page=1&pageSize=100&platformFilters=%7B%22filters%22:%5B%7B%22key%22:%22@SearchName%22,%22label%22:%22Search+Name%22,%22values%22:%5B%22SEARCH_FILTER_VALUE%22%5D%7D,%7B%22key%22:%22@LastNameFirstLetter%22,%22label%22:%22Last+Name+First+Letter%22,%22values%22:%5B%22A%22%5D%7D%5D%7D&sort=')
      .then((res) => res.json())
      .then((res) => handleOfficers(res, token))
      .then((officers) => Promise.all(officers))
      .then(console.log);
}

/** Fetches all data about every officer. */
function handleOfficers(json: any, token: string): Promise<Officer>[] {
  return json.Data.map((officer) => {
    const taxId = parseInt(officer.RowValue);
    return fetch('https://oip.nypdonline.org/api/reports/1/datasource/list', {
      method: 'POST',
      body: '{filters: [{key: "@TAXID", label: "TAXID", values: ["' +
        taxId + '"]}]}',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'user=' + token,
      },
    })
        .then((res) => res.json())
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
  const nameRe = new RegExp('(.*), (.*)');
  const match = name.trim().match(nameRe);
  return {
    first: match[2],
    last: match[1],
  };
}
