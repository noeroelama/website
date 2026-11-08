import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

const b64url = (bytes: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(bytes));
type CBOR = Parameters<typeof isoCBOR.encode>[0];
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export function createSoftwareAuthenticator(origin: string, userId: string) {
  const rpIdHash = sha256(new URL(origin).hostname);
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(16);
  const id = b64url(credentialId);
  let counter = 0;

  const coseKey = isoCBOR.encode(
    new Map<number, CBOR>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x ?? "")],
      [-3, isoBase64URL.toBuffer(jwk.y ?? "")],
    ]),
  );
  const clientData = (type: string, challenge: string, o = origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));

  return {
    id,
    register(challenge: string, opts: { origin?: string } = {}) {
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45]),
        u32(counter),
        Buffer.alloc(16),
        idLength,
        credentialId,
        coseKey,
      ]);
      const attestationObject = isoCBOR.encode(
        new Map<string, CBOR>([
          ["fmt", "none"],
          ["attStmt", new Map<string, CBOR>()],
          ["authData", new Uint8Array(authData)],
        ]),
      );
      return {
        id,
        rawId: id,
        type: "public-key" as const,
        response: {
          clientDataJSON: b64url(clientData("webauthn.create", challenge, opts.origin)),
          attestationObject: b64url(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
      };
    },
    authenticate(
      challenge: string,
      opts: { origin?: string; counter?: number; userHandle?: string } = {},
    ) {
      counter = opts.counter ?? counter + 1;
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), u32(counter)]);
      const data = clientData("webauthn.get", challenge, opts.origin);
      const signature = sign("sha256", Buffer.concat([authData, sha256(data)]), privateKey);
      return {
        id,
        rawId: id,
        type: "public-key" as const,
        response: {
          clientDataJSON: b64url(data),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
          userHandle: opts.userHandle ?? b64url(Buffer.from(userId)),
        },
        clientExtensionResults: {},
      };
    },
  };
}
