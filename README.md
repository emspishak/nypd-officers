# nypd-officers

Scrapes NYPD's officer profile into a JSON object.

This scrapes all available data from https://nypdonline.org/link/2 into a JSON
object. The output JSON is a list of [`Officer`](src/officer.ts) objects.

To run:

```
npm run nypd
```
