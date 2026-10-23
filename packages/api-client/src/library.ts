import type { MobileCapabilities } from './index';

export type MobilePermission = 'account_ai' | 'library_sync';
export const mobileAIPermissions: readonly MobilePermission[] = ['account_ai'];
export const mobileLibraryPermissions: readonly MobilePermission[] = ['account_ai', 'library_sync'];
export const mobileLibraryEntities = ['book', 'position', 'note', 'bookmark'] as const;
export type MobileLibraryEntity = (typeof mobileLibraryEntities)[number];

/** A server transport capability, not a claim that a client has enabled account libraries. */
export type MobileLibraryCapabilities = Omit<
  MobileCapabilities,
  'version' | 'nativeAccountSync'
> & {
  version: 2;
  nativeAccountSync: boolean;
  librarySync: { version: 1; entities: readonly MobileLibraryEntity[] };
  permissions: MobilePermission[];
};

export function readMobilePermissions(value: unknown): MobilePermission[] | null {
  if (
    !Array.isArray(value) ||
    value.length > mobileLibraryPermissions.length ||
    value.some((permission) => !mobileLibraryPermissions.includes(permission)) ||
    new Set(value).size !== value.length
  )
    return null;
  return [...value] as MobilePermission[];
}

type LibraryTransport = (
  path: '/api/mobile/v2/config',
) => Promise<{ status: number; body: unknown }>;

/** Opt in to the v2 contract explicitly; v1 discovery remains unchanged for older apps. */
export function createLibraryApiClient(transport: LibraryTransport) {
  return {
    async getCapabilities(): Promise<MobileLibraryCapabilities> {
      const response = await transport('/api/mobile/v2/config');
      const body = response.body as Partial<MobileLibraryCapabilities> | null;
      const permissions = readMobilePermissions(body?.permissions);
      const entities = body?.librarySync?.entities;
      if (
        response.status !== 200 ||
        body?.version !== 2 ||
        body.product !== 'bypage' ||
        body.portableLibrary !== 1 ||
        typeof body.nativeAccountSync !== 'boolean' ||
        typeof body.nativeAccount !== 'boolean' ||
        typeof body.authenticated !== 'boolean' ||
        typeof body.nativeAI !== 'boolean' ||
        typeof body.nativeTranslation !== 'boolean' ||
        body.librarySync?.version !== 1 ||
        !Array.isArray(entities) ||
        entities.length !== mobileLibraryEntities.length ||
        new Set(entities).size !== entities.length ||
        !mobileLibraryEntities.every((entity) => entities.includes(entity)) ||
        permissions === null ||
        (body.nativeAccountSync && !body.nativeAccount) ||
        (!body.authenticated && permissions.length > 0) ||
        (body.authenticated && !permissions.includes('account_ai'))
      )
        throw new Error('unsupported_server_response');
      return {
        version: 2,
        product: 'bypage',
        portableLibrary: 1,
        nativeAccountSync: body.nativeAccountSync,
        nativeAccount: body.nativeAccount,
        authenticated: body.authenticated,
        nativeAI: body.nativeAI,
        nativeTranslation: body.nativeTranslation,
        librarySync: { version: 1, entities: [...mobileLibraryEntities] },
        permissions,
        ...(typeof body.aiModel === 'string' && body.aiModel.length <= 200
          ? { aiModel: body.aiModel }
          : {}),
        ...(typeof body.aiContextKey === 'string' && /^[a-f0-9]{64}$/.test(body.aiContextKey)
          ? { aiContextKey: body.aiContextKey }
          : {}),
        ...(typeof body.translationContextKey === 'string' &&
        /^[a-f0-9]{64}$/.test(body.translationContextKey)
          ? { translationContextKey: body.translationContextKey }
          : {}),
      };
    },
  };
}
