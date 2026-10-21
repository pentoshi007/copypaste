type Raw = Record<string, unknown>;

const COPYABLE_FIELDS = [
  "type",
  "content",
  "language",
  "checked",
  "collapsed",
  "color",
  "storage",
  "imageUrl",
  "publicId",
  "storageKey",
  "attachments",
  "fileName",
  "fileSize",
  "mimeType",
] as const;

export function copyBlockFields(source: Raw): Raw {
  const result: Raw = {};
  for (const field of COPYABLE_FIELDS) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
}
