import { Conversation, Deal, Campaign, WhatsappInstance, Attendant, QuickReply } from '../types';

export const mockQuickReplies: QuickReply[] = [
  {
    id: 'quick-reply-proposta', companyId: 'mock-company', scope: 'COMPANY', shortcut: '/proposta', title: 'Proposta Comercial PIX',
    body: 'Segue a proposta comercial para o lote com 5% de desconto no PIX: R$ 58.995,00.', position: 0, usageCount: 0, isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'quick-reply-frete', companyId: 'mock-company', scope: 'COMPANY', shortcut: '/frete', title: 'Prazo de Entrega',
    body: 'O prazo de entrega para Curitiba é de 2 a 3 dias úteis após a confirmação do pagamento.', position: 1, usageCount: 0, isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const mockAttendants: Attendant[] = [
  { id: '1', name: 'Leo Vitorino', avatar: '/VITSTOCK®/PERFIL/2.png', role: 'admin', online: true },
  { id: '2', name: 'Carlos Santos', avatar: '/VITSTOCK®/PERFIL/3.png', role: 'attendant', online: true },
  { id: '3', name: 'Mariana Lima', avatar: '/VITSTOCK®/PERFIL/4.png', role: 'attendant', online: false },
];

export const mockConversations: Conversation[] = [
  {
    id: 'conv-1',
    contact: {
      id: 'c-1',
      name: 'Marcos Oliveira (Auto Peças)',
      phone: '+55 21 99887-6655',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      email: 'marcos@autopecasrio.com.br',
      tags: [
        { id: 't1', name: 'VIP', color: '#EEBB2C' },
        { id: 't2', name: 'Pneu Moto', color: '#3B82F6' }
      ],
      notes: 'Cliente interessado em lote de pneus Michelin 245/45. Fechar proposta até sexta.',
      createdAt: '2026-07-01'
    },
    lastMessage: 'Gostaria de confirmar o valor do frete para Curitiba no lote de 50 unidades.',
    lastMessageTimestamp: '14:05',
    conversationTags: [
      { id: 'traffic', name: 'Tráfego', color: '#F97316', systemKey: 'traffic' },
      { id: 'tag-vip-conversation', name: 'VIP', color: '#EEBB2C' },
    ],
    trafficSource: 'whatsapp_campaign',
    unreadCount: 2,
    status: 'open',
    assignedAttendant: mockAttendants[0],
    department: 'Vendas'
  },
  {
    id: 'conv-2',
    contact: {
      id: 'c-2',
      name: 'Oficina Central Barra',
      phone: '+55 21 98112-3344',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      email: 'contato@oficinabarra.com',
      tags: [
        { id: 't3', name: 'Atacado', color: '#10B981' }
      ],
      notes: 'Fatura mensal vence dia 30.',
      createdAt: '2026-06-15'
    },
    lastMessage: 'Perfeito! O boleto foi pago, obrigado.',
    lastMessageTimestamp: '12:30',
    unreadCount: 0,
    status: 'open',
    assignedAttendant: mockAttendants[1],
    department: 'Financeiro'
  },
  {
    id: 'conv-3',
    contact: {
      id: 'c-3',
      name: 'Juliana Costa',
      phone: '+55 11 97654-3210',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      tags: [
        { id: 't4', name: 'Novo Lead', color: '#EC4899' }
      ],
      createdAt: '2026-07-24'
    },
    lastMessage: 'Vocês vendem kit de rodas esportivas com aro 18?',
    lastMessageTimestamp: 'Ontem',
    unreadCount: 0,
    status: 'pending',
    department: 'Suporte'
  }
];

export const mockDeals: Deal[] = [
  {
    id: 'deal-1',
    title: 'Lote 50x Pneus Michelin',
    contactName: 'Marcos Oliveira (Auto Peças)',
    contactPhone: '+55 21 99887-6655',
    value: 58995.00,
    stage: 'negociacao',
    tags: [{ id: 't1', name: 'VIP', color: '#EEBB2C' }],
    createdAt: '2026-07-20'
  },
  {
    id: 'deal-2',
    title: 'Kit Rodas Liga Leve Aro 18',
    contactName: 'Juliana Costa',
    contactPhone: '+55 11 97654-3210',
    value: 4800.00,
    stage: 'novo',
    tags: [{ id: 't4', name: 'Novo Lead', color: '#EC4899' }],
    createdAt: '2026-07-24'
  },
  {
    id: 'deal-3',
    title: 'Fornecimento Mensal Oficina Barra',
    contactName: 'Oficina Central Barra',
    contactPhone: '+55 21 98112-3344',
    value: 14500.00,
    stage: 'fechado',
    tags: [{ id: 't3', name: 'Atacado', color: '#10B981' }],
    createdAt: '2026-07-10'
  }
];

export const mockCampaigns: Campaign[] = [
  {
    id: 'camp-1',
    title: 'Oferta Diária - Pneus & Rodas em Destaque',
    targetType: 'group',
    targetGroupJid: '120363029988@g.us',
    targetGroupName: '🚗 Vitstock - Grupo de Ofertas VIP',
    imageUrl: '/VITSTOCK®/PRINCIPAL/1.png',
    caption: '🚀 *OFERTA DO DIA VITSTOCK!* Pneu Michelin 245/45 por apenas R$ 1.179,90 em até 12x de R$ 113,02! Estoque limitado. Chame no privado para garantir o seu!',
    scheduleTime: '09:00',
    scheduleDays: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'],
    isActive: true,
    lastSentAt: '2026-07-24 09:00'
  }
];

export const mockInstances: WhatsappInstance[] = [
  {
    id: 'inst-1',
    name: 'vitstock_atendimento',
    phone: '+55 21 99887-0000',
    status: 'connected',
    profileName: 'Vitstock Atendimento Oficial'
  }
];
