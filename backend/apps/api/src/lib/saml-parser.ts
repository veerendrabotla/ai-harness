/**
 * SAML Response Parser.
 * Parses SAML 2.0 responses and extracts user attributes.
 * Includes XML signature verification when an IDP certificate is provided.
 */
import { createHash, createVerify, type Verify } from "node:crypto";
import pino from "pino";

const log = pino({ name: "saml-parser", level: "warn" });

export interface SamlUserInfo {
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  providerId?: string;
  attributes: Record<string, string>;
}

/**
 * Parse a base64-encoded SAML response and extract user info.
 */
export function parseSamlResponse(samlResponseBase64: string): SamlUserInfo {
  const xml = Buffer.from(samlResponseBase64, "base64").toString("utf-8");
  return parseSamlXml(xml);
}

/**
 * Parse SAML XML and extract user attributes.
 */
export function parseSamlXml(xml: string): SamlUserInfo {
  const attributes: Record<string, string> = {};

  // Extract NameID (email)
  const nameIdMatch = xml.match(/<NameID[^>]*>([^<]+)<\/NameID>/);
  const email = nameIdMatch?.[1]?.trim() ?? "";

  // Extract common attributes
  const attributePatterns: Array<{ pattern: RegExp; key: string }> = [
    { pattern: /<Attribute\s+Name="([^"]*email[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "email" },
    { pattern: /<Attribute\s+Name="([^"]*name[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "name" },
    { pattern: /<Attribute\s+Name="([^"]*firstName[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "firstName" },
    { pattern: /<Attribute\s+Name="([^"]*lastName[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "lastName" },
    { pattern: /<Attribute\s+Name="([^"]*picture[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "avatarUrl" },
    { pattern: /<Attribute\s+Name="([^"]*uid[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "providerId" },
    { pattern: /<Attribute\s+Name="([^"]*upn[^"]*)"[^>]*>\s*<AttributeValue[^>]*>([^<]+)<\/AttributeValue>/i, key: "upn" },
  ];

  for (const { pattern, key } of attributePatterns) {
    const match = xml.match(pattern);
    if (match?.[2]) {
      attributes[key] = match[2].trim();
    }
  }

  // Extract all Attribute elements generically
  const allAttributesRegex = /<Attribute\s+Name="([^"]+)"[^>]*>\s*(?:<AttributeValue[^>]*>([^<]*)<\/AttributeValue>)?\s*<\/Attribute>/g;
  let match;
  while ((match = allAttributesRegex.exec(xml)) !== null) {
    if (match[1] && match[2] && !attributes[match[1]]) {
      attributes[match[1]] = match[2].trim();
    }
  }

  // Build user info from extracted attributes
  const name = attributes.name
    ?? (attributes.firstName && attributes.lastName
      ? `${attributes.firstName} ${attributes.lastName}`
      : attributes.firstName
        ?? attributes.lastName
        ?? email.split("@")[0]
        ?? "SAML User");

  return {
    email: attributes.email ?? email,
    name,
    firstName: attributes.firstName,
    lastName: attributes.lastName,
    avatarUrl: attributes.avatarUrl,
    providerId: attributes.providerId ?? attributes.uid,
    attributes,
  };
}

/**
 * Validate SAML response structure (basic checks).
 */
export function validateSamlResponse(input: string): { valid: boolean; errors: string[] } {
  // Decode base64 if it looks like base64 (not already XML)
  let xml = input;
  if (!input.includes("<")) {
    try {
      xml = Buffer.from(input, "base64").toString("utf-8");
    } catch (err) {
      log.error({ err }, "[SAML] Base64 decode failed, using input as-is:");
    }
  }
  const errors: string[] = [];

  // Check for required elements
  if (!xml.includes("<samlp:Response") && !xml.includes("<Response")) {
    errors.push("Missing SAML Response element");
  }
  if (!xml.includes("<saml:Assertion") && !xml.includes("<Assertion")) {
    errors.push("Missing SAML Assertion element");
  }
  if (!xml.includes("<NameID") && !xml.includes("<saml:NameID")) {
    errors.push("Missing NameID element");
  }

  // Check for signature — reject if missing (production security)
  const hasSignature = xml.includes("<ds:Signature") || xml.includes("<Signature");
  if (!hasSignature) {
    errors.push("REJECTED: No XML signature found - signed assertions required");
  }

  // Check expiry
  const notOnOrAfterMatch = xml.match(/NotOnOrAfter="([^"]+)"/);
  if (notOnOrAfterMatch?.[1]) {
    const expiry = new Date(notOnOrAfterMatch[1]);
    if (expiry < new Date()) {
      errors.push("SAML assertion has expired");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verify the XML signature in a SAML response against an IDP certificate.
 * Uses the reference URI to locate the signed element, extracts the digest
 * from the signature, and verifies using the IDP's public certificate.
 *
 * This is a simplified but functional implementation. For full SAML compliance,
 * consider using xml-crypto with inclusive namespaces.
 */
export function verifySamlSignature(
  samlXml: string,
  idpCertificatePem: string,
): { verified: boolean; error?: string } {
  // Check for signature element
  const sigMatch = samlXml.match(/<ds:Signature[\s>][\s\S]*?<\/ds:Signature>|<Signature[\s>][\s\S]*?<\/Signature>/);
  if (!sigMatch) {
    return { verified: false, error: "No XML signature found in SAML response" };
  }
  const sigBlock = sigMatch[0];

  // Extract the SignedInfo element
  const signedInfoMatch = sigBlock.match(/<ds:SignedInfo[\s>][\s\S]*?<\/ds:SignedInfo>|<SignedInfo[\s>][\s\S]*?<\/SignedInfo>/);
  if (!signedInfoMatch) {
    return { verified: false, error: "Missing SignedInfo element in signature" };
  }
  const signedInfo = signedInfoMatch[0];

  // Extract the Reference URI to identify the signed element
  const refMatch = signedInfo.match(/URI="([^"]+)"/);
  const refUri = refMatch?.[1];

  // Extract the DigestValue
  const digestMatch = signedInfo.match(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>|<DigestValue>([^<]+)<\/DigestValue>/);
  const digestValue = digestMatch?.[1] ?? digestMatch?.[2];
  if (!digestValue) {
    return { verified: false, error: "Missing DigestValue in signature" };
  }

  // Extract the SignatureValue
  const sigValueMatch = sigBlock.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>|<SignatureValue>([^<]+)<\/SignatureValue>/);
  const signatureValue = sigValueMatch?.[1] ?? sigValueMatch?.[2];
  if (!signatureValue) {
    return { verified: false, error: "Missing SignatureValue in signature" };
  }

  // Find the referenced element and compute its digest
  let signedElement: string | undefined;
  if (refUri) {
    const id = refUri.startsWith("#") ? refUri.slice(1) : refUri;
    // Try to find element by Id attribute
    const idPatterns = [
      new RegExp(`<[^>]+\\s+ID="${id}"[\\s>][\\s\\S]*?<\\/[^>]+>`, "i"),
      new RegExp(`<[^>]+\\s+id="${id}"[\\s>][\\s\\S]*?<\\/[^>]+>`, "i"),
    ];
    for (const pat of idPatterns) {
      const m = samlXml.match(pat);
      if (m) { signedElement = m[0]; break; }
    }
  }

  // Fallback: extract the Assertion element itself
  if (!signedElement) {
    const assertionMatch = samlXml.match(/<saml:Assertion[\s>][\s\S]*?<\/saml:Assertion>|<Assertion[\s>][\s\S]*?<\/Assertion>/);
    if (assertionMatch) {
      signedElement = assertionMatch[0];
    }
  }

  if (!signedElement) {
    return { verified: false, error: "Could not locate signed element in SAML response" };
  }

  // Detect digest algorithm from SignedInfo (SHA-256 preferred, SHA-1 for legacy compat)
  const digestAlgoMatch = signedInfo.match(/Algorithm="[^"]*#(sha1|sha256|sha384|sha512)[^"]*"/i);
  const digestAlgo = (digestAlgoMatch?.[1]?.toLowerCase() ?? "sha1") as "sha1" | "sha256" | "sha384" | "sha512";
  // SAML standard digest — upgrade path: prefer SHA-256 when IDP supports it
  const computedDigest = createHash(digestAlgo).update(signedElement, "utf8").digest("base64");

  if (computedDigest !== digestValue) {
    return { verified: false, error: `Digest mismatch (${digestAlgo}) — SAML response may have been tampered with` };
  }

  // Verify the signature using the IDP certificate (algorithm from SignedInfo)
  const sigAlgoMatch = sigBlock.match(/Algorithm="[^"]*#(rsa-sha1|rsa-sha256|rsa-sha384|rsa-sha512)[^"]*"/i);
  const sigAlgo = (sigAlgoMatch?.[1]?.toLowerCase() ?? "rsa-sha1") as string;
  try {
    const verifier: Verify = createVerify(sigAlgo);
    verifier.update(signedInfo);
    const valid = verifier.verify(idpCertificatePem, signatureValue, "base64");
    if (!valid) {
      return { verified: false, error: "Signature verification failed — invalid certificate or tampered data" };
    }
  } catch (err) {
    return { verified: false, error: `Signature verification error: ${(err as Error).message}` };
  }

  return { verified: true };
}
