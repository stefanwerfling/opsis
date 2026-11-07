/** Small, strict row readers: a schema mismatch fails loudly instead of leaking `unknown`. */
type Row = Record<string, unknown>;

export const str = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`Column "${column}" is not a string`);
  return value;
};

export const optStr = (row: Row, column: string): string | null => {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Column "${column}" is not a string or null`);
  return value;
};

export const num = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number') throw new Error(`Column "${column}" is not a number`);
  return value;
};

export const optNum = (row: Row, column: string): number | null =>
  row[column] === null ? null : num(row, column);

/** Parses a JSON column; callers narrow the result (the column has a json_valid CHECK). */
export const json = (row: Row, column: string): unknown => JSON.parse(str(row, column));

/** Narrows a stored string to a known union, guarding against unexpected DB contents. */
export const oneOf = <T extends string>(row: Row, column: string, allowed: readonly T[]): T => {
  const value = str(row, column);
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`Column "${column}" has unexpected value`);
  return value as T;
};
