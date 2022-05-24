# [1.3.0](https://github.com/regrapes/access-db-parser/compare/v1.2.0...v1.3.0) (2022-05-24)


### Features

* Allow special use case buffer handling ([7769877](https://github.com/regrapes/access-db-parser/commit/7769877627108e7927960b85374cbddb2abd6121))

# [1.2.0](https://github.com/regrapes/access-db-parser/compare/v1.1.0...v1.2.0) (2022-05-09)


### Features

* Support for LVAL type 2 ([297287f](https://github.com/regrapes/access-db-parser/commit/297287f5d9736824c14bd3307738a562d91c6326))

# [1.1.0](https://github.com/regrapes/access-db-parser/compare/v1.0.1...v1.1.0) (2022-03-23)


### Features

* enforce UTC date ([5c32569](https://github.com/regrapes/access-db-parser/commit/5c32569224c0c0b37abd3a6dfcca91973c78515a))

## [1.0.1](https://github.com/regrapes/access-db-parser/compare/v1.0.0...v1.0.1) (2022-01-18)


### Bug Fixes

* add missing build step ([846cc9d](https://github.com/regrapes/access-db-parser/commit/846cc9d9ccf06eb156d7c785a749fc2df9b905d3))

# 1.0.0 (2022-01-18)


* DateTime to ISO String Format ([a50c8af](https://github.com/regrapes/access-db-parser/commit/a50c8af9b0bc7e10caaecd5878aea144e6cd26ad))


### Features

* refactored ([12e5c46](https://github.com/regrapes/access-db-parser/commit/12e5c46c13dbbbe1a4b79377b1cbcd71fc8109e9))


### BREAKING CHANGES

* this adds hours,minutes and seconds to the date output and normalize the output to ISO string `YYYY-MM-DDTHH:mm:ss.sssZ` instead of `dd/mm/yyyy`
