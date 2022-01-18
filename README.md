# @regrapes/access-db-parser

Forked from [QuentinJanuel/AccessDB-parser](https://github.com/QuentinJanuel/AccessDB-parser)
which was originally a rewrite of the python package [claroty/access_parser](https://github.com/claroty/access_parser)
## Use

```ts
import { AccessParser } from "@regrapes/access-db-parser";
import fs from 'fs'

// Load your access file in a node buffer
const dbFile = fs.readFileSync('./YOUR_FILE.accdb')

const db = new AccessParser(myFileBuffer);

const tables = db.getTables(); // -> ["tableName1", "tableName2"]

const table = db.parseTable("tableName1"); // -> [{data: {name: "John", age: 23}, rowNumber: 1},{data: {name: "Bill", age: 56}, rowNumber: 2}]
```

## Special thanks

- https://github.com/QuentinJanuel/AccessDB-parser
- https://github.com/claroty/access_parser
