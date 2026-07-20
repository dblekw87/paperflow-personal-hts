import { z } from "zod";

import { KisApiError } from "../errors.js";
import {
  isSupportedWsTrId,
  resolveWsLayout,
  type SupportedWsTrId,
} from "./layouts.js";

export interface KisPipeFrame {
  kind: "DATA";
  encrypted: false;
  trId: SupportedWsTrId;
  recordCount: number;
  records: ReadonlyArray<Readonly<Record<string, string | null>>>;
}

export interface KisControlFrame {
  kind: "CONTROL";
  trId: string;
  trKey: string | null;
  isPingPong: boolean;
  success: boolean | null;
  message: string | null;
}

const controlSchema = z
  .object({
    header: z
      .object({
        tr_id: z.string(),
        tr_key: z.string().optional(),
        encrypt: z.string().optional(),
      })
      .loose(),
    body: z
      .object({
        rt_cd: z.string(),
        msg1: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

function parseControlFrame(raw: string): KisControlFrame {
  const parsedJson: unknown = JSON.parse(raw);
  const result = controlSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new KisApiError({
      code: "KIS_WS_CONTROL_SCHEMA_MISMATCH",
      message: "KIS WebSocket control frame has an unexpected shape",
      retryable: false,
    });
  }

  const { header, body } = result.data;
  return {
    kind: "CONTROL",
    trId: header.tr_id,
    trKey: header.tr_key ?? null,
    isPingPong: header.tr_id === "PINGPONG",
    success: body ? body.rt_cd === "0" : null,
    message: body?.msg1 ?? null,
  };
}

function parsePipeFrame(raw: string): KisPipeFrame {
  const [encryptedFlag, trId, countText, ...payloadParts] = raw.split("|");
  if (!encryptedFlag || !trId || !countText || payloadParts.length === 0) {
    throw new KisApiError({
      code: "KIS_WS_MALFORMED_FRAME",
      message: "KIS WebSocket data frame is missing pipe-delimited fields",
      retryable: false,
    });
  }

  if (encryptedFlag === "1") {
    throw new KisApiError({
      code: "UNSUPPORTED_ENCRYPTED_FRAME",
      message:
        "Encrypted trade-notice frames are not supported by the read-only probe",
      retryable: false,
    });
  }
  if (encryptedFlag !== "0") {
    throw new KisApiError({
      code: "KIS_WS_UNKNOWN_ENCRYPTION_FLAG",
      message: "KIS WebSocket frame encryption flag is invalid",
      retryable: false,
    });
  }
  if (!isSupportedWsTrId(trId)) {
    throw new KisApiError({
      code: "KIS_WS_UNKNOWN_TR_ID",
      message: `Unsupported market-data TR ID: ${trId}`,
      retryable: false,
    });
  }

  if (!/^\d+$/.test(countText)) {
    throw new KisApiError({
      code: "KIS_WS_INVALID_RECORD_COUNT",
      message: "KIS WebSocket record count is invalid",
      retryable: false,
    });
  }
  const recordCount = Number.parseInt(countText, 10);
  if (!Number.isSafeInteger(recordCount) || recordCount <= 0) {
    throw new KisApiError({
      code: "KIS_WS_INVALID_RECORD_COUNT",
      message: "KIS WebSocket record count is invalid",
      retryable: false,
    });
  }

  const values = payloadParts.join("|").split("^");
  if (values.length % recordCount !== 0) {
    throw new KisApiError({
      code: "KIS_WS_FIELD_COUNT_MISMATCH",
      message: `TR ${trId} received ${values.length} fields for ${recordCount} records`,
      retryable: false,
    });
  }
  const fieldsPerRecord = values.length / recordCount;
  const layout = resolveWsLayout(trId, fieldsPerRecord);
  if (layout === null) {
    throw new KisApiError({
      code: "KIS_WS_FIELD_COUNT_MISMATCH",
      message: `TR ${trId} does not support ${fieldsPerRecord} fields per record`,
      retryable: false,
    });
  }

  const records: Array<Readonly<Record<string, string | null>>> = [];
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const record: Record<string, string | null> = {};
    for (let fieldIndex = 0; fieldIndex < layout.length; fieldIndex += 1) {
      const valueIndex = recordIndex * layout.length + fieldIndex;
      const field = layout[fieldIndex];
      const value = values[valueIndex];
      if (field === undefined || value === undefined) {
        throw new KisApiError({
          code: "KIS_WS_FIELD_COUNT_MISMATCH",
          message: "KIS WebSocket field mapping failed",
          retryable: false,
        });
      }
      record[field] = value === "" ? null : value;
    }
    records.push(record);
  }

  return {
    kind: "DATA",
    encrypted: false,
    trId,
    recordCount,
    records,
  };
}

export function parseKisWsFrame(raw: string): KisPipeFrame | KisControlFrame {
  const first = raw[0];
  if (first === "0" || first === "1") {
    return parsePipeFrame(raw);
  }
  return parseControlFrame(raw);
}
