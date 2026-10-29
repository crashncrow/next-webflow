---
"next-webflow": minor
---

`getItems` filters are typed from the generated schema: keys must be fields of the collection (camelCase or API slug), and Option fields take only the schema's option IDs with `eq`, `ne`, `in` and `nin`. A misspelled field or an option name (which Webflow answers with an empty list) now fails type checking instead of at request time. A plain `string`, such as a route param, has to be narrowed to the option IDs first. New types: `FilterOf`, `TypedGetItemsOptions` and `OptionIdOf`. Clients without a generated schema are unchanged.
