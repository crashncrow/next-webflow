const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

/** Webflow DateTime fields are ISO strings. */
export const formatDate = (iso: string | undefined) => (iso ? dateFormat.format(new Date(iso)) : undefined);

/** Comma-separated names, skipping references that resolved to `null`. */
export const names = (items: ReadonlyArray<{ fieldData: { name: string } } | null>) =>
  items.flatMap((item) => (item ? [item.fieldData.name] : [])).join(", ");
