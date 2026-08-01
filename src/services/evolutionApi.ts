import { WhatsappInstance, Conversation, Message } from '../types';
import { mockInstances, mockConversations } from './mockData';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_EVOLUTION_API_URL ? import.meta.env.VITE_EVOLUTION_API_URL : '/evolution-api';
const API_KEY = import.meta.env.VITE_EVOLUTION_API_KEY || 'vitstock_global_key_2026';
const USE_MOCK = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export class EvolutionApiService {
  /**
   * Buscar status da conexão da instância
   */
  static async getInstanceStatus(instanceName: string): Promise<WhatsappInstance> {
    if (USE_MOCK) {
      return mockInstances[0];
    }

    try {
      // 1. Consultar fetchInstances para verificar disconnectionAt e disconnectionReasonCode
      const fetchRes = await fetch(`${API_URL}/instance/fetchInstances`, {
        headers: { 'apikey': API_KEY }
      });
      
      let fetchedInst: any = null;
      if (fetchRes.ok) {
        const instances = await fetchRes.json();
        if (Array.isArray(instances)) {
          fetchedInst = instances.find((i: any) => i.name === instanceName || i.instanceName === instanceName);
        }
      }

      // Se connectionStatus for open no fetchInstances, o WhatsApp está pareado!
      if (fetchedInst && fetchedInst.connectionStatus === 'open') {
        const rawOwner = fetchedInst.ownerJid || '';
        const cleanPhone = rawOwner.split('@')[0];
        return {
          id: instanceName,
          name: instanceName,
          status: 'connected',
          profileName: fetchedInst.profileName || 'Vitstock WhatsApp',
          phone: cleanPhone ? `+${cleanPhone}` : ''
        };
      }

      // Se houver registro de desconexão recente ou status close/connecting
      if (fetchedInst && (fetchedInst.connectionStatus === 'close' || fetchedInst.connectionStatus === 'connecting')) {
        return {
          id: instanceName,
          name: instanceName,
          status: 'disconnected',
          phone: fetchedInst.ownerJid ? fetchedInst.ownerJid.split('@')[0] : ''
        };
      }

      // Fallback: Checar a rota de connectionState
      const res = await fetch(`${API_URL}/instance/connectionState/${instanceName}`, {
        headers: { 'apikey': API_KEY }
      });
      if (!res.ok) {
        return await this.createInstance(instanceName);
      }
      const data = await res.json();
      const state = data?.instance?.state || data?.state;

      return {
        id: instanceName,
        name: instanceName,
        status: state === 'open' ? 'connected' : 'disconnected',
        phone: data?.instance?.owner || (fetchedInst?.ownerJid ? fetchedInst.ownerJid.split('@')[0] : '')
      };
    } catch (err) {
      console.warn('Evolution API indisponível ou em criação:', err);
      return {
        id: instanceName,
        name: instanceName,
        status: 'disconnected'
      };
    }
  }

  /**
   * Criar nova instância na Evolution API v2
   */
  static async createInstance(instanceName: string): Promise<WhatsappInstance> {
    if (USE_MOCK) return mockInstances[0];

    try {
      const res = await fetch(`${API_URL}/instance/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({
          instanceName,
          token: API_KEY,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        })
      });
      const data = await res.json();
      const qr = data?.qrcode?.base64 || data?.base64 || data?.code;
      return {
        id: instanceName,
        name: instanceName,
        status: 'disconnected',
        qrCodeUrl: qr
      };
    } catch (err) {
      console.error('Erro ao criar instância:', err);
      return {
        id: instanceName,
        name: instanceName,
        status: 'disconnected'
      };
    }
  }

  /**
   * Obter QR Code real para conectar WhatsApp
   */
  static async getConnectQrCode(instanceName: string): Promise<string | null> {
    if (USE_MOCK) return null;

    try {
      const res = await fetch(`${API_URL}/instance/connect/${instanceName}`, {
        headers: { 'apikey': API_KEY }
      });
      const data = await res.json();
      return data?.base64 || data?.qrcode?.base64 || data?.code || null;
    } catch (err) {
      console.error('Erro ao buscar QR Code:', err);
      return null;
    }
  }

  /**
   * Buscar conversas reais diretamente da Evolution API no Railway
   */
  /**
   * Buscar conversas reais diretamente da Evolution API no Railway (com deduplicação e busca de nomes)
   */
  static async fetchRealChats(instanceName: string): Promise<Conversation[]> {
    if (USE_MOCK) return mockConversations;

    try {
      console.log(`[EvolutionAPI] Buscando conversas e contatos do Railway para: ${instanceName}`);
      let rawChats: any[] = [];
      let contactsMap = new Map<string, { name: string; avatar: string }>();

      // 1. Busca conversas e contatos em paralelo
      const [resChats, resContacts] = await Promise.all([
        fetch(`${API_URL}/chat/findChats/${instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': API_KEY },
          body: JSON.stringify({})
        }),
        fetch(`${API_URL}/chat/findContacts/${instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': API_KEY },
          body: JSON.stringify({})
        })
      ]);

      // Popula o mapa de contatos para resolver nomes salvos
      if (resContacts.ok) {
        const contactsData = await resContacts.json();
        if (Array.isArray(contactsData)) {
          contactsData.forEach((c: any) => {
            const rawJid = c.remoteJid || c.id || '';
            const phoneKey = rawJid.split('@')[0].replace(/\D/g, '');
            if (phoneKey && c.pushName && c.pushName !== 'WhatsApp Business' && c.pushName !== 'Você') {
              contactsMap.set(phoneKey, {
                name: c.pushName,
                avatar: c.profilePicUrl || ''
              });
            }
          });
        }
      }

      if (resChats.ok) {
        const chatsData = await resChats.json();
        if (Array.isArray(chatsData)) rawChats = chatsData;
      }

      if (rawChats.length === 0 && contactsMap.size === 0) return [];

      // 2. Mapeamento e Deduplicação por número de telefone (cleanNumber)
      const conversationsMap = new Map<string, Conversation>();

      rawChats.forEach((item: any, index: number) => {
        // Ignora chats de grupos por enquanto se necessário, ou inclui se tiver remoteJid
        const isGroup = item.remoteJid?.includes('@g.us') || item.id?.includes('@g.us');
        if (isGroup) return; // Filtra grupos da aba principal de atendimento individual

        const keyRemoteJid = item.lastMessage?.key?.remoteJidAlt || item.remoteJid || item.id || `chat-${index}`;
        const cleanNumber = keyRemoteJid.split('@')[0].replace(/\D/g, '');

        if (!cleanNumber) return;

        // Resolve o Nome Salvo (Prioridade: Mapa de Contatos > pushName da Mensagem > Nome do Chat > Número)
        const savedContact = contactsMap.get(cleanNumber);
        let displayName = savedContact?.name ||
                          item.lastMessage?.pushName || 
                          item.pushName || 
                          item.name || 
                          item.verifiedName;

        if (!displayName || displayName === 'Você' || displayName === 'WhatsApp Business') {
          displayName = `+${cleanNumber}`;
        }

        const messageContent = 
          item.lastMessage?.message?.conversation ||
          item.lastMessage?.message?.extendedTextMessage?.text ||
          item.lastMessage?.message?.imageMessage?.caption ||
          (item.lastMessage?.message?.audioMessage ? '[Áudio]' : null) ||
          (item.lastMessage?.message?.imageMessage ? '[Imagem]' : null) ||
          (item.lastMessage?.message?.documentMessage ? '[Documento]' : null) ||
          'Conversa iniciada';

        const timestampStr = item.updatedAt || item.lastMessage?.messageTimestamp
          ? new Date(item.updatedAt || Number(item.lastMessage?.messageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Hoje';

        const conversationObj: Conversation = {
          id: keyRemoteJid,
          contact: {
            id: keyRemoteJid,
            name: displayName,
            phone: `+${cleanNumber}`,
            avatar: savedContact?.avatar || item.profilePicUrl || item.profilePictureUrl || '',
            tags: [{ id: 't-real', name: 'WhatsApp', color: '#10B981' }],
            createdAt: new Date().toISOString().split('T')[0]
          },
          lastMessage: messageContent,
          lastMessageTimestamp: timestampStr,
          unreadCount: item.unreadCount || 0,
          status: 'open',
          department: 'Atendimento Geral'
        };

        // Se o mapa já tiver este número, atualiza apenas se a mensagem for mais recente ou se o nome for melhor que a entrada existente
        if (conversationsMap.has(cleanNumber)) {
          const existing = conversationsMap.get(cleanNumber)!;
          if (existing.contact.name.startsWith('+') && !displayName.startsWith('+')) {
            existing.contact.name = displayName;
          }
        } else {
          conversationsMap.set(cleanNumber, conversationObj);
        }
      });

      return Array.from(conversationsMap.values());
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao carregar chats/contatos:', err);
      return [];
    }
  }

  /**
   * Enviar mensagem de texto diretamente via Evolution API no Railway
   */
  static async sendTextMessage(instanceName: string, number: string, text: string) {
    if (USE_MOCK) {
      console.log(`[MOCK EVOLUTION API] Enviar para ${number}: "${text}"`);
      return { status: 'SUCCESS', messageId: `msg-${Date.now()}` };
    }

    const cleanNumber = number.replace(/\D/g, '');

    try {
      const res = await fetch(`${API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({
          number: cleanNumber,
          text: text,
          delay: 1200,
          linkPreview: true
        })
      });

      const responseData = await res.json();
      console.log('[EvolutionAPI] Resposta do envio real:', responseData);
      return responseData;
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao enviar mensagem:', err);
      return null;
    }
  }


  /**
   * Buscar histórico de mensagens de uma conversa diretamente da Evolution API no Railway
   */
  static async fetchMessages(instanceName: string, remoteJid: string): Promise<Message[]> {
    if (USE_MOCK) return [];

    try {
      const cleanJid = remoteJid.includes('@') ? remoteJid : `${remoteJid.replace(/\D/g, '')}@s.whatsapp.net`;

      const res = await fetch(`${API_URL}/chat/findMessages/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({
          where: {
            key: {
              remoteJid: cleanJid
            }
          },
          limit: 100
        })
      });

      if (!res.ok) return [];
      const data = await res.json();
      let rawMsgs = data?.records || data?.messages || (Array.isArray(data) ? data : []);

      if ((!Array.isArray(rawMsgs) || rawMsgs.length === 0) && data?.messages?.records) {
        rawMsgs = data.messages.records;
      }

      if (!Array.isArray(rawMsgs)) return [];

      return rawMsgs.map((m: any, idx: number) => {
        const fromMe = m.key?.fromMe ?? false;
        
        let mediaUrl: string | undefined = undefined;
        let mediaType: 'image' | 'audio' | 'document' | undefined = undefined;

        const imgMsg = m.message?.imageMessage || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const audioMsg = m.message?.audioMessage || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
        const docMsg = m.message?.documentMessage;

        if (imgMsg) {
          mediaType = 'image';
          if (imgMsg.url && imgMsg.url.startsWith('http')) {
            mediaUrl = imgMsg.url;
          } else if (imgMsg.jpegThumbnail) {
            mediaUrl = imgMsg.jpegThumbnail.startsWith('data:') ? imgMsg.jpegThumbnail : `data:image/jpeg;base64,${imgMsg.jpegThumbnail}`;
          }
        } else if (audioMsg) {
          mediaType = 'audio';
          if (audioMsg.url && audioMsg.url.startsWith('http')) {
            mediaUrl = audioMsg.url;
          }
        } else if (docMsg) {
          mediaType = 'document';
          mediaUrl = docMsg.url;
        }

        const msgContent = 
          m.message?.conversation || 
          m.message?.extendedTextMessage?.text || 
          imgMsg?.caption || 
          m.message?.videoMessage?.caption ||
          (audioMsg ? '[Mensagem de Áudio]' : null) ||
          (imgMsg ? (imgMsg.caption || '[Imagem]') : null) ||
          (docMsg ? '[Documento]' : null) ||
          '[Mensagem]';

        const timestampStr = m.messageTimestamp 
          ? new Date(Number(m.messageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Agora';

        const senderType: 'attendant' | 'contact' = fromMe ? 'attendant' : 'contact';
        const msgStatus: 'sent' | 'delivered' | 'read' = 'read';

        return {
          id: m.key?.id || m.id || `real-msg-${idx}`,
          conversationId: remoteJid,
          sender: senderType,
          senderName: fromMe ? 'Atendente' : (m.pushName || 'Contato'),
          content: msgContent,
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          timestamp: timestampStr,
          status: msgStatus,
          isInternalNote: false
        };
      }).reverse();
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao buscar mensagens:', err);
      return [];
    }
  }
}
