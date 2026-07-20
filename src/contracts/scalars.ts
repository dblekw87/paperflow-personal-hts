import { z } from "zod";

export const DecimalStringSchema = z
  .string()
  .regex(/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected an exact decimal string");

export const UnsignedIntegerStringSchema = z
  .string()
  .regex(/^\d+$/, "Expected an unsigned integer string");

export const UtcInstantSchema = z.string().datetime({ offset: true });

export const InstrumentIdSchema = z
  .string()
  .regex(/^[A-Z]+:[A-Z0-9.-]+$/, "Expected VENUE:SYMBOL");

export type DecimalString = z.infer<typeof DecimalStringSchema>;
