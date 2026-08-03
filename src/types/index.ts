export type ChatStatus = 'open' | 'pending' | 'resolved';

export interface Attendant {
  id: string;
  name: string;
  avatar: string;
  role: 'admin' | 'attendant';
  online: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  avatar?: string;
  email?: string;
  cpf?: string;
  address?: string;
  otherPhone?: string;
  tags: Tag[];
  notes?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: 'contact' | 'attendant' | 'system';
  senderName?: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'document' | 'sticker';
  mediaDuration?: number;
  interactiveTitle?: string;
  interactiveFooter?: string;
  interactiveButtons?: Array<{
    type: 'url' | 'quickReply' | 'call' | 'copy';
    label: string;
    url?: string;
    value?: string;
  }>;
  rawKey?: any;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  isInternalNote?: boolean;
}

export interface Conversation {
  id: string;
  contact: Contact;
  lastMessage: string;
  lastMessageTimestamp: string;
  lastMessageAt?: number;
  lastMessageFromMe?: boolean;
  lastMessageKey?: {
    id: string;
    remoteJid: string;
    fromMe?: boolean;
    [key: string]: unknown;
  };
  unreadCount: number;
  needsResponse?: boolean;
  status: ChatStatus;
  assignedAttendant?: Pick<Attendant, 'id' | 'name'>;
  department: string;
}

export interface Deal {
  id: string;
  title: string;
  contactName: string;
  contactPhone: string;
  value: number;
  stage: 'novo' | 'negociacao' | 'proposta' | 'fechado';
  tags: Tag[];
  createdAt: string;
}

export interface Campaign {
  id: string;
  title: string;
  targetType: 'group' | 'contacts';
  targetGroupJid?: string;
  targetGroupName?: string;
  imageUrl?: string;
  caption: string;
  scheduleTime: string; // ex: "09:00"
  scheduleDays: string[]; // ex: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]
  isActive: boolean;
  lastSentAt?: string;
}

export interface WhatsappInstance {
  id: string;
  name: string;
  phone?: string;
  status: 'connected' | 'connecting' | 'disconnected';
  qrCodeUrl?: string;
  profileName?: string;
}
