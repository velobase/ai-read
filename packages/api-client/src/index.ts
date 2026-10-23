export type MobileCapabilities = {
  version: 1;
  product: 'bypage';
  portableLibrary: 1;
  nativeAccountSync: false;
  nativeAccount: boolean;
  authenticated: boolean;
  nativeAI: boolean;
  nativeTranslation: boolean;
  aiModel?: string;
  aiContextKey?: string;
};
export const mobileCapabilities: MobileCapabilities = {
  version: 1,
  product: 'bypage',
  portableLibrary: 1,
  nativeAccountSync: false,
  nativeAccount: false,
  authenticated: false,
  nativeAI: false,
  nativeTranslation: false,
};
export type Transport = (
  path: '/api/mobile/v1/config',
) => Promise<{ status: number; body: unknown }>;
export function createApiClient(transport: Transport) {
  return {
    async getCapabilities(): Promise<MobileCapabilities> {
      const response = await transport('/api/mobile/v1/config');
      const body = response.body as Partial<MobileCapabilities> | null;
      if (
        response.status !== 200 ||
        body?.version !== 1 ||
        body.product !== 'bypage' ||
        body.portableLibrary !== 1 ||
        body.nativeAccountSync !== false ||
        typeof body.nativeAI !== 'boolean'
      )
        throw new Error('unsupported_server_response');
      return {
        ...mobileCapabilities,
        nativeAccount: body.nativeAccount === true,
        authenticated: body.authenticated === true,
        nativeAI: body.nativeAI,
        nativeTranslation: body.nativeTranslation === true,
        ...(typeof body.aiModel === 'string' && body.aiModel.length <= 200
          ? { aiModel: body.aiModel }
          : {}),
        ...(typeof body.aiContextKey === 'string' && /^[a-f0-9]{64}$/.test(body.aiContextKey)
          ? { aiContextKey: body.aiContextKey }
          : {}),
      };
    },
  };
}

export * from './assistant';
export * from './library';
