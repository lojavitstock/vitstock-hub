import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      companyId: string;
      name: string;
      email: string;
      role: 'admin' | 'attendant';
    } | null;
  }
}
