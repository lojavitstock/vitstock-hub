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
  mediaType?: 'image' | 'audio' | 'document';
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
  unreadCount: number;
  status: ChatStatus;
  assignedAttendant?: Attendant;
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
