import React, { useCallback, useState } from 'react';
import { Search, UserPlus, MessageSquare, Filter, RefreshCw, Cloud, CloudOff } from 'lucide-react';
import { mockConversations } from '../services/mockData';
import { Contact } from '../types';
import { EvolutionApiService } from '../services/evolutionApi';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../services/api';

type ApiContact = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  cpf?: string | null;
  address?: string | null;
  secondary_phone?: string | null;
  avatar_url?: string | null;
  notes?: string | null;
  nickname?: string | null;
  birthday?: string | null;
  company?: string | null;
  job_title?: string | null;
  website?: string | null;
  google_resource_name?: string | null;
  google_etag?: string | null;
  google_synced_at?: string | null;
  google_data?: Record<string, unknown> | null;
  source?: string;
  created_at: string;
};

const ContactAvatar: React.FC<{ contact: Contact }> = ({ contact }) => {
  const initials = contact.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className="relative w-9 h-9 rounded-full overflow-hidden border border-[#46535a] bg-[#2a343a] flex-shrink-0">
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-extrabold text-amber-300">{initials}</span>
      {contact.avatar && (
        <img
          src={contact.avatar}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}
    </div>
  );
};

export const ContatosPage: React.FC = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Form State
  const [newContact, setNewContact] = useState({ name: '', phone: '', email: '', tag: 'Novo Lead' });

  const mapApiContacts = (items: ApiContact[]): Contact[] => items.map((contact) => ({
    id: contact.id,
    name: contact.name,
    phone: `+${contact.phone}`,
    email: contact.email || undefined,
    cpf: contact.cpf || undefined,
    address: contact.address || undefined,
    addresses: Array.isArray((contact.google_data as any)?.addresses)
      ? ((contact.google_data as any).addresses as Array<{ formattedValue?: string; streetAddress?: string; city?: string; region?: string; postalCode?: string; country?: string }>).map((address) => address.formattedValue || [address.streetAddress, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(', ')).filter(Boolean)
      : contact.address ? [contact.address] : undefined,
    otherPhone: contact.secondary_phone ? `+${contact.secondary_phone}` : undefined,
    nickname: contact.nickname || undefined,
    birthday: contact.birthday || undefined,
    company: contact.company || undefined,
    jobTitle: contact.job_title || undefined,
    website: contact.website || undefined,
    googleResourceName: contact.google_resource_name || undefined,
    googleEtag: contact.google_etag || undefined,
    googleSyncedAt: contact.google_synced_at || undefined,
    googleData: contact.google_data || undefined,
    avatar: contact.avatar_url || undefined,
    notes: contact.notes || undefined,
    tags: [{ id: `source-${contact.id}`, name: contact.source === 'google' ? 'Google' : 'Hub', color: contact.source === 'google' ? '#34A853' : '#EEBB2C' }],
    createdAt: new Date(contact.created_at).toLocaleDateString('pt-BR'),
  }));

  const loadRealContacts = useCallback(async () => {
      setLoading(true);
      try {
        const [status, stored] = await Promise.all([
          apiRequest<{ connected: boolean }>('/api/google/status'),
          apiRequest<{ contacts: ApiContact[] }>('/api/contacts'),
        ]);
        setGoogleConnected(status.connected);
        if (stored.contacts.length > 0) {
          setContacts(mapApiContacts(stored.contacts));
        } else {
          const chats = await EvolutionApiService.fetchRealChats('vitstock_atendimento');
          setContacts(chats.map(c => c.contact));
        }
      } catch {
        const chats = await EvolutionApiService.fetchRealChats('vitstock_atendimento');
        setContacts(chats.length > 0 ? chats.map(c => c.contact) : mockConversations.map(c => c.contact));
      }
      setLoading(false);
  }, []);

  React.useEffect(() => {
    loadRealContacts();
  }, [loadRealContacts]);

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('google') === 'connected') {
      setFeedback('Google Contacts conectado. Clique em Sincronizar contatos.');
      window.history.replaceState({}, '', '/contatos');
    }
  }, []);

  const handleGoogleConnect = async () => {
    try {
      const { url } = await apiRequest<{ url: string }>('/api/google/connect');
      window.location.assign(url);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível conectar ao Google');
    }
  };

  const handleGoogleSync = async () => {
    setSyncing(true);
    setFeedback('');
    try {
      const result = await apiRequest<{ imported: number; total: number }>('/api/google/sync', { method: 'POST' });
      setFeedback(`${result.imported} contatos com telefone sincronizados.`);
      await loadRealContacts();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Falha ao sincronizar contatos');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name || !newContact.phone) return;
    try {
      const result = await apiRequest<{ googleSynced: boolean }>('/api/contacts', {
        method: 'POST', body: JSON.stringify({ name: newContact.name, phone: newContact.phone, email: newContact.email }),
      });
      setFeedback(result.googleSynced ? 'Contato salvo no Hub e no Google Contacts.' : 'Contato salvo no Hub. Conecte o Google para sincronizá-lo.');
      setIsModalOpen(false);
      setNewContact({ name: '', phone: '', email: '', tag: 'Novo Lead' });
      await loadRealContacts();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    }
  };

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  return (
    <div className="flex-1 h-full p-6 overflow-y-auto bg-zinc-950 font-overpass">
      
      {/* Header da Página */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-extrabold text-zinc-100 flex items-center gap-2">
            Base de Contatos & Clientes
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20 font-bold">
              {contacts.length} cadastrados
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">Gerencie os clientes e etiquetas vinculados ao WhatsApp</p>
        </div>

        <div className="flex items-center gap-2">
          {googleConnected ? (
            <button onClick={handleGoogleSync} disabled={syncing} className="btn-secondary text-xs">
              <RefreshCw className={`w-4 h-4 text-emerald-400 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sincronizando...' : 'Sincronizar Google'}
            </button>
          ) : (
            <button onClick={handleGoogleConnect} className="btn-secondary text-xs">
              <CloudOff className="w-4 h-4 text-amber-400" /> Conectar Google
            </button>
          )}
          <button onClick={() => setIsModalOpen(true)} className="btn-primary text-xs">
            <UserPlus className="w-4 h-4" /> Adicionar Contato
          </button>
        </div>
      </div>

      {feedback && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#20292f] border border-[#344047] text-xs text-slate-200 flex items-center gap-2">
          <Cloud className="w-4 h-4 text-emerald-400" /> {feedback}
        </div>
      )}

      {/* Filtros e Busca */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input 
            type="text" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
          />
        </div>

        <button className="btn-secondary text-xs">
          <Filter className="w-4 h-4 text-zinc-400" /> Filtrar Etiquetas
        </button>
      </div>

      {/* Tabela de Contatos */}
      <div className="bg-[#0C0C0E] border border-zinc-800/80 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900/80 text-zinc-400 uppercase font-bold text-[10px] tracking-wider border-b border-zinc-800">
            <tr>
              <th className="py-3.5 px-4">Cliente</th>
              <th className="py-3.5 px-4">Telefone (WhatsApp)</th>
              <th className="py-3.5 px-4">E-mail</th>
              <th className="py-3.5 px-4">Etiquetas</th>
              <th className="py-3.5 px-4">Data de Cadastro</th>
              <th className="py-3.5 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {!loading && filteredContacts.map(contact => (
              <tr key={contact.id} className="hover:bg-zinc-900/40 transition-colors">
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <ContactAvatar contact={contact} />
                    <span className="font-bold text-zinc-100">{contact.name}</span>
                  </div>
                </td>
                <td className="py-3.5 px-4 font-mono text-amber-400 font-semibold">{contact.phone}</td>
                <td className="py-3.5 px-4 text-zinc-400">{contact.email || '-'}</td>
                <td className="py-3.5 px-4">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map(tag => (
                      <span 
                        key={tag.id}
                        className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3.5 px-4 text-zinc-500">{contact.createdAt}</td>
                <td className="py-3.5 px-4 text-right">
                  <button 
                    onClick={() => navigate('/atendimento', { state: { startChat: { phone: contact.phone, name: contact.name } } })}
                    className="px-3 py-1.5 rounded-lg bg-amber-400/10 text-amber-400 border border-amber-400/30 hover:bg-amber-400 hover:text-zinc-950 font-bold transition-all inline-flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Iniciar Chat
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Adicionar Contato */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#0C0C0E] border border-zinc-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-zinc-100">Novo Contato WhatsApp</h2>
            <form onSubmit={handleAddContact} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-zinc-400 block mb-1">Nome Completo</label>
                <input 
                  type="text" 
                  required
                  value={newContact.name}
                  onChange={e => setNewContact({...newContact, name: e.target.value})}
                  placeholder="Ex: Carlos Silva"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-400 block mb-1">Telefone WhatsApp</label>
                <input 
                  type="text" 
                  required
                  value={newContact.phone}
                  onChange={e => setNewContact({...newContact, phone: e.target.value})}
                  placeholder="+55 21 99999-8888"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-400 block mb-1">E-mail (Opcional)</label>
                <input 
                  type="email" 
                  value={newContact.email}
                  onChange={e => setNewContact({...newContact, email: e.target.value})}
                  placeholder="cliente@email.com"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>

              <p className="text-[11px] text-zinc-500">O contato será salvo no Hub e, quando conectado, também no Google Contacts.</p>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="btn-primary text-xs"
                >
                  Salvar Contato
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
