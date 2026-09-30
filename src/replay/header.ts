export type HeaderProperty =
  | {type: "bool"; value: boolean}
  | {type: "byte"; kind: string; value: string | null}
  | {type: "array"; value: HeaderEntries[]}
  | {type: "float"; value: number}
  | {type: "int"; value: number}
  | {type: "qword"; value: bigint}
  | {type: "name"; value: string}
  | {type: "str"; value: string}
  | {type: "struct"; name: string; fields: HeaderEntries};

export type HeaderEntry = [string, HeaderProperty];
export type HeaderEntries = HeaderEntry[];

export interface ReplayHeader {
  headerSize: number;
  headerCrc: number;
  majorVersion: number;
  minorVersion: number;
  netVersion: number | null;
  gameType: string;
  properties: HeaderEntries;
}

const utf8 = new TextDecoder("utf-8", {fatal: true});
const utf16 = new TextDecoder("utf-16le");
const windows1252 = new TextDecoder("windows-1252");

class Reader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  position(): number {
    return this.offset;
  }

  take(size: number, label: string): Uint8Array {
    if (!Number.isInteger(size) || size < 0 || size > this.remaining()) {
      throw new ReplayParseError(
        `Replay ended while reading ${label}: needed ${size} byte(s), ${this.remaining()} remain.`,
        this.offset,
      );
    }
    const value = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  i32(label: string): number {
    this.require(4, label);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u32(label: string): number {
    this.require(4, label);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(label: string): bigint {
    this.require(8, label);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  f32(label: string): number {
    this.require(4, label);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  parseStr(label: string): string {
    const size = this.i32(`${label} length`);
    if (size < 0 || size > 100_000) {
      throw new ReplayParseError(`Invalid ${label} length: ${size}.`, this.offset - 4);
    }
    const data = this.take(size, label);
    const content = data.subarray(0, Math.max(0, data.byteLength - 1));
    try {
      return utf8.decode(content);
    } catch {
      throw new ReplayParseError(`Invalid UTF-8 while reading ${label}.`, this.offset - size);
    }
  }

  parseText(label: string): string {
    const characters = this.i32(`${label} length`);
    if (characters < -10_000 || characters > 10_000) {
      throw new ReplayParseError(`Invalid ${label} text length: ${characters}.`, this.offset - 4);
    }

    if (characters < 0) {
      const byteLength = characters * -2;
      const data = this.take(byteLength, label);
      return utf16.decode(data.subarray(0, Math.max(0, data.byteLength - 2)));
    }

    const data = this.take(characters, label);
    return windows1252.decode(data.subarray(0, Math.max(0, data.byteLength - 1)));
  }

  private require(size: number, label: string): void {
    if (this.remaining() < size) {
      throw new ReplayParseError(
        `Replay ended while reading ${label}: needed ${size} byte(s), ${this.remaining()} remain.`,
        this.offset,
      );
    }
  }
}

export class ReplayParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "ReplayParseError";
    this.offset = offset;
  }
}

function parseDictionary(reader: Reader, depth = 0): HeaderEntries {
  if (depth > 20) {
    throw new ReplayParseError("Replay header property nesting is too deep.", reader.position());
  }

  const entries: HeaderEntries = [];
  let propertyCount = 0;

  while (true) {
    propertyCount += 1;
    if (propertyCount > 50_000) {
      throw new ReplayParseError("Replay header contains too many properties.", reader.position());
    }

    const key = reader.parseStr("property key");
    if (key === "None") break;

    const kind = reader.parseStr(`property type for ${key}`);
    reader.u32(`property size for ${key}`);
    reader.take(4, `property index for ${key}`);

    let property: HeaderProperty | null;
    switch (kind) {
      case "BoolProperty":
        property = {type: "bool", value: reader.take(1, key)[0] === 1};
        break;
      case "ByteProperty": {
        const byteKind = reader.parseStr(`${key} byte kind`);
        if (byteKind === "None") {
          reader.take(1, `${key} byte value`);
          property = null;
        } else {
          property = {
            type: "byte",
            kind: byteKind,
            value: reader.parseStr(`${key} byte value`),
          };
        }
        break;
      }
      case "ArrayProperty": {
        const count = reader.i32(`${key} array length`);
        if (count < 0 || count > 25_000) {
          throw new ReplayParseError(`Invalid ${key} array length: ${count}.`, reader.position() - 4);
        }
        const value: HeaderEntries[] = [];
        for (let index = 0; index < count; index += 1) {
          value.push(parseDictionary(reader, depth + 1));
        }
        property = {type: "array", value};
        break;
      }
      case "FloatProperty":
        property = {type: "float", value: reader.f32(key)};
        break;
      case "IntProperty":
        property = {type: "int", value: reader.i32(key)};
        break;
      case "QWordProperty":
        property = {type: "qword", value: reader.u64(key)};
        break;
      case "NameProperty":
        property = {type: "name", value: reader.parseText(key)};
        break;
      case "StrProperty":
        property = {type: "str", value: reader.parseText(key)};
        break;
      case "StructProperty": {
        const name = reader.parseStr(`${key} struct name`);
        property = {type: "struct", name, fields: parseDictionary(reader, depth + 1)};
        break;
      }
      default:
        throw new ReplayParseError(`Unsupported replay header property type: ${kind}.`, reader.position());
    }

    if (property) entries.push([key, property]);
  }

  return entries;
}

export function parseReplayHeader(buffer: ArrayBuffer): ReplayHeader {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 12) {
    throw new ReplayParseError("File is too small to be a Rocket League replay.", 0);
  }

  const outer = new Reader(bytes);
  const headerSize = outer.i32("header size");
  const headerCrc = outer.u32("header CRC");

  if (headerSize <= 0 || headerSize > 2_000_000 || headerSize > outer.remaining()) {
    throw new ReplayParseError(`Invalid replay header size: ${headerSize}.`, 0);
  }

  const headerReader = new Reader(outer.take(headerSize, "replay header"));
  const majorVersion = headerReader.i32("major version");
  const minorVersion = headerReader.i32("minor version");
  const netVersion = majorVersion > 865 && minorVersion > 17
    ? headerReader.i32("network version")
    : null;
  const gameType = headerReader.parseText("game type");
  const properties = parseDictionary(headerReader);

  return {
    headerSize,
    headerCrc,
    majorVersion,
    minorVersion,
    netVersion,
    gameType,
    properties,
  };
}

export function property(entries: HeaderEntries, key: string): HeaderProperty | null {
  return entries.find(([name]) => name === key)?.[1] ?? null;
}

export function stringProperty(entries: HeaderEntries, key: string): string | null {
  const value = property(entries, key);
  if (!value) return null;
  if (value.type === "str" || value.type === "name") return value.value;
  return null;
}

export function intProperty(entries: HeaderEntries, key: string): number | null {
  const value = property(entries, key);
  return value?.type === "int" ? value.value : null;
}

export function boolProperty(entries: HeaderEntries, key: string): boolean | null {
  const value = property(entries, key);
  return value?.type === "bool" ? value.value : null;
}

export function idProperty(entries: HeaderEntries, key: string): string | null {
  const value = property(entries, key);
  if (!value) return null;
  if (value.type === "qword") return value.value.toString();
  if (value.type === "str" || value.type === "name") return value.value;
  if (value.type === "int") return String(value.value);
  return null;
}
