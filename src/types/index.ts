export type ChatStatus = 'open' | 'pending' | 'resolved';

export interface Attendant {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  role: 'admin' | 'attendant';
  online: boolean;
  active?: boolean;
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
  addresses?: string[];
  otherPhone?: string;
  otherPhones?: string[];
  emails?: string[];
  nickname?: string;
  birthday?: string;
  company?: string;
  jobTitle?: string;
  website?: string;
  googleResourceName?: string;
  googleEtag?: string;
  googleSyncedAt?: string;
  googleData?: Record<string, unknown>;
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
  mediaType?: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  mediaDuration?: number;
  interactiveTitle?: string;
  interactiveFooter?: string;
  interactiveButtons?: Array<{
    type: 'url' | 'quickReply' | 'call' | 'copy';
    label: string;
    url?: string;
    value?: string;
  }>;
  metadata?: {
    providerType?: string;
    trafficSource?: string;
    trafficTitle?: string;
    trafficUrl?: string;
    sentByHub?: boolean;
    sentByUserId?: string;
    sentByUserName?: string;
    sentOutsideHub?: boolean;
    clientMessageId?: string;
    quotedMessage?: {
      messageId: string;
      authorName?: string;
      sender?: 'contact' | 'attendant' | 'system';
      content?: string;
      mediaType?: 'image' | 'audio' | 'video' | 'document' | 'sticker';
      key?: {
        id: string;
        remoteJid?: string;
        fromMe?: boolean;
        participant?: string;
      };
    };
    document?: {
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
      url?: string;
    };
    contactCard?: {
      displayName: string;
      phone?: string;
    };
    reactions?: Array<{
      emoji: string;
      reactorKey: string;
      actorId: string;
      actorName?: string;
      participant?: string;
      fromMe?: boolean;
      updatedAt: number;
    }>;
    /** Participant identity used by WhatsApp group messages/replies. */
    participantJid?: string;
    participantName?: string;
    reaction?: string;
    systemLabel?: string;
    forwarded?: boolean;
  };
  rawKey?: any;
  timestampMs?: number;
  timestamp: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  isInternalNote?: boolean;
}

export interface Conversation {
  id: string;
  isGroup?: boolean;
  groupName?: string;
  groupAvatar?: string;
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
  lease?: {
    ownerUserId: string;
    ownerName: string;
    expiresAt: number;
  };
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
