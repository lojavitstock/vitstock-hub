import { z } from 'zod';

// Official OpenAPI linked by developer.bling.com.br/referencia (2026-10-03).
export const API_BASE = 'https://api.bling.com.br/Api/v3';
export const AUTHORIZATION_URL = 'https://bling.com.br/Api/v3/oauth/authorize';
// aplicativos + JWT guide use api.bling.com.br; OpenAPI securityScheme uses bling.com.br.
export const TOKEN_URL = `${API_BASE}/oauth/token`;
export class BlingError extends Error {
  constructor(public statusCode = 502, message = 'Não foi possível consultar o Bling') { super(message); }
}
export const idSchema = z.union([z.string().regex(/^[1-9]\d{0,19}$/), z.number().int().positive().safe()]).transform(String);
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const fields = {
  id: idSchema, nome: z.string(), codigo: z.string().optional(), preco: z.number().optional(),
  tipo: z.enum(['S', 'P', 'N']), situacao: z.enum(['A', 'I']), formato: z.enum(['S', 'V', 'E']),
  descricaoCurta: z.string().optional(),
};
export const productListModel = z.object({ ...fields, idProdutoPai: idSchema.optional(),
  // E was observed in the product list only. Detail remains constrained to
  // A/I, and the selectable catalog applies criterio=2 and fails closed.
  situacao: z.enum(['A', 'I', 'E']),
  estoque: z.object({ saldoVirtualTotal: z.number().optional() }).optional(),
});
const detailFields = { ...fields, unidade: z.string().optional(), gtin: z.string().optional(),
  idProdutoPai: idSchema.optional(),
  categoria: z.object({ id: idSchema }).optional(),
  variacao: z.object({ nome: z.string(), ordem: z.number().int(),
    produtoPai: z.object({ id: idSchema, cloneInfo: z.boolean().optional() }) }).optional(),
};
export const productDetailModel = z.object({ ...detailFields, variacoes: z.array(z.object(detailFields)).optional() });
export const warehouseModel = z.object({ id: idSchema, descricao: z.string(), situacao: z.union([z.literal(0), z.literal(1)]),
  padrao: z.boolean(), desconsiderarSaldo: z.boolean() });
export const stockModel = z.object({ produto: z.object({ id: idSchema }), saldoFisicoTotal: z.number().finite().optional(),
  saldoVirtualTotal: z.number().finite().optional(), depositos: z.array(z.object({ id: idSchema,
    saldoFisico: z.number().finite().optional(), saldoVirtual: z.number().finite().optional() })).optional() });
const nullableText = z.string().nullish();
export const blingContactListModel = z.object({
  id: idSchema,
  nome: z.string(),
  situacao: z.enum(['A', 'E', 'I', 'S']).optional(),
  numeroDocumento: nullableText,
  telefone: nullableText,
  celular: nullableText,
});
const contactAddressModel = z.object({
  endereco: nullableText, cep: nullableText, bairro: nullableText, municipio: nullableText,
  uf: nullableText, numero: nullableText, complemento: nullableText,
}).nullish();
export const blingContactDetailModel = blingContactListModel.extend({
  fantasia: nullableText,
  tipo: z.enum(['J', 'F', 'E']).optional(),
  email: nullableText,
  endereco: z.object({ geral: contactAddressModel, cobranca: contactAddressModel }).nullish(),
});
export const blingSalesOrderModel = z.object({
  id: idSchema.optional(),
  numero: z.union([z.number().int(), z.string()]).nullish(),
  data: nullableText,
  total: z.number().finite().nullish(),
  situacao: z.object({ id: idSchema.optional(), valor: nullableText }).nullish(),
});
export const tokenModel = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().min(1).max(16000),
  token_type: z.string().refine(v => v.toLowerCase() === 'bearer'), expires_in: z.number().int().positive().max(86400) });
export type Tokens = z.infer<typeof tokenModel>;
export function parseContract<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BlingError(502, 'Resposta do Bling fora do contrato esperado');
  return parsed.data;
}
