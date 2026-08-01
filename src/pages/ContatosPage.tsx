import React, { useState } from 'react';
import { Search, UserPlus, Tag as TagIcon, Phone, Mail, MessageSquare, MoreHorizontal, Filter } from 'lucide-react';
import { mockConversations } from '../services/mockData';
import { Contact } from '../types';
import { useNavigate } from 'react-router-dom';

export const ContatosPage: React.FC = () => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>(mockConversations.map(c => c.contact));
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [newContact, setNewContact] = useState({ name: '', phone: '', email: '', tag: 'Novo Lead' });

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name || !newContact.phone) return;

    const contact: Contact = {
      id: `c-${Date.now()}`,
      name: newContact.name,
      phone: newContact.phone,
      email: newContact.email,
      tags: [{ id: 't-new', name: newContact.tag, color: '#EEBB2C' }],
      createdAt: new Date().toISOString().split('T')[0]
    };

    setContacts(prev => [contact, ...prev]);
    setIsModalOpen(false);
    setNewContact({ name: '', phone: '', email: '', tag: 'Novo Lead' });
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

        <button 
          onClick={() => setIsModalOpen(true)}
          className="btn-primary text-xs"
        >
          <UserPlus className="w-4 h-4" /> Adicionar Contato
        </button>
      </div>

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
            {filteredContacts.map(contact => (
              <tr key={contact.id} className="hover:bg-zinc-900/40 transition-colors">
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <img 
                      src={contact.avatar} 
                      alt={contact.name}
                      className="w-9 h-9 rounded-full object-cover border border-zinc-800" 
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=EEBB2C&color=000`;
                      }}
                    />
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
                    onClick={() => navigate('/atendimento')}
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
