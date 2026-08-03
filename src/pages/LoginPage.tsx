import React, { useState } from 'react';
import { Loader2, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível entrar');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 font-overpass">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0C0C0E] p-7 shadow-2xl">
        <div className="mb-7">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400 text-black mb-4">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-extrabold text-zinc-100">Vitstock Hub</h1>
          <p className="mt-1 text-sm text-zinc-500">Entre com sua conta de atendimento.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-zinc-400">E-mail</span>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-zinc-600" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-3 text-sm text-zinc-100 outline-none transition focus:border-amber-400"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-zinc-400">Senha</span>
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-3 h-4 w-4 text-zinc-600" />
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-3 text-sm text-zinc-100 outline-none transition focus:border-amber-400"
              />
            </div>
          </label>

          {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
};
