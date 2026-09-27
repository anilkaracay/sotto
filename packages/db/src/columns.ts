// Column helpers shared by the schema. drizzle-orm 0.45.3 pg-core has no bytea column, so bytea is a
// custom type: Uint8Array in the application, Buffer at the postgres.js driver.
import { customType, timestamp } from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

/** Every timestamp is timestamptz in UTC (08). */
export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: "date" });
}
