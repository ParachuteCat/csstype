import * as rawProperties from 'mdn-data/css/properties.json';
import * as rawSyntaxes from 'mdn-data/css/syntaxes.json';
import { getPropertyData, getTypesData } from './compat';
import { createPropertyDataTypeResolver, resolveDataTypes } from './data-types';
import { IExtendedProperty, properties as patchedProperties, syntaxes as patchedSyntaxes } from './data/patches';
import { properties as rawSvgProperties, syntaxes as rawSvgSyntaxes } from './data/svg';
import { error, warn } from './logger';
import parse from './parser';
import typing, { hasType } from './typer';

export let getProperties = async () => {
  const properties: { [property: string]: IExtendedProperty } = {};

  for (const name in rawProperties) {
    properties[name] = {
      ...rawProperties[name],
      syntax: await getPropertySyntax(name),
      shorthand:
        name in patchedProperties && typeof patchedProperties[name].shorthand === 'boolean'
          ? patchedProperties[name].shorthand
          : Array.isArray(rawProperties[name].computed),
    };
  }

  for (const name in patchedProperties) {
    if (!(name in rawProperties)) {
      properties[name] = patchedProperties[name];
    }
  }

  // Cache
  getProperties = () => Promise.resolve(properties);

  return properties;
};

export let getSyntaxes = async () => {
  const syntaxes: { [property: string]: MDN.Syntax } = {};

  for (const name in rawSvgSyntaxes) {
    syntaxes[name] = {
      syntax: await getSyntax(name),
    };
  }

  for (const name in rawSyntaxes) {
    syntaxes[name] = {
      syntax: await getSyntax(name),
    };
  }

  for (const name in patchedSyntaxes) {
    if (!(name in rawSyntaxes || name in rawSvgSyntaxes)) {
      syntaxes[name] = patchedSyntaxes[name];
    }
  }

  // Cache
  getSyntaxes = () => Promise.resolve(syntaxes);

  return syntaxes;
};

export function isProperty(name: string) {
  return (
    name in rawProperties || name in rawSvgProperties || (name in patchedProperties && !!patchedProperties[name].syntax)
  );
}

export function isSyntax(name: string) {
  return name in rawSyntaxes || name in rawSvgSyntaxes || (name in patchedSyntaxes && !!patchedSyntaxes[name].syntax);
}

const validatedPropertySyntaxes: string[] = [];

export async function getPropertySyntax(name: string) {
  const patch = patchedProperties[name];
  const rawSyntax = rawProperties[name] && rawProperties[name].syntax;

  if (patch && patch.syntax) {
    if (rawSyntax && !validatedPropertySyntaxes.includes(name)) {
      const compatibilityData = await getPropertyData(name);

      if (compatibilityData && !validatePatch(compatibilityData, rawProperties[name].syntax, patch.syntax)) {
        error(
          'The patched property `%s` did not patch the source with anything or was incomplete compared to source',
          name,
        );
      }

      validatedPropertySyntaxes.push(name);
    }

    return patch.syntax;
  }

  if (!rawSyntax) {
    warn('Syntax for property `%s` is missing', name);
  }

  return rawSyntax;
}

const validatedSyntaxes: string[] = [];

export async function getSyntax(name: string) {
  const patch = patchedSyntaxes[name];

  const rawSyntax =
    name in rawSyntaxes ? rawSyntaxes[name].syntax : rawSvgSyntaxes[name] && rawSvgSyntaxes[name].syntax;

  if (patch && patch.syntax) {
    if (rawSyntax && !validatedSyntaxes.includes(name)) {
      const compatibilityData = await getTypesData(name);

      if (compatibilityData && !validatePatch(compatibilityData, rawSyntaxes[name].syntax, patch.syntax)) {
        error(
          'The patched syntax `%s` did not patch the source with anything or was incomplete compared to source',
          name,
        );
      }

      validatedSyntaxes.push(name);
    }

    return patch.syntax;
  }

  if (!rawSyntax) {
    warn('Syntax for `%s` is missing', name);
  }

  return rawSyntax;
}

async function validatePatch(compat: MDN.CompatData, sourceSyntax: string, patchSyntax: string): Promise<boolean> {
  // Dissolve all data types to check whether it already exists or not
  const dissolvedSourceTypes = await resolveDataTypes(
    typing(parse(sourceSyntax)),
    createPropertyDataTypeResolver(compat, Infinity),
    Infinity,
  );
  const dissolvedPatchTypes = await resolveDataTypes(
    typing(parse(patchSyntax)),
    createPropertyDataTypeResolver(compat, Infinity),
    Infinity,
  );

  for (const type of dissolvedSourceTypes) {
    if (!hasType(dissolvedPatchTypes, type)) {
      return false;
    }
  }

  let complements = false;
  for (const type of dissolvedPatchTypes) {
    if (!hasType(dissolvedSourceTypes, type)) {
      complements = true;
      break;
    }
  }

  return complements;
}
