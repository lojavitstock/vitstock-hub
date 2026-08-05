import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../services/api';
import { EvolutionApiService } from '../services/evolutionApi';
import { Conversation } from '../types';

export type GoogleContactForm = {
  name: string;
  phone: string;
  otherPhone: string;
  email: string;
  cpf: string;
  address: string;
  resourceName: string;
};

export type GoogleContactStatus = 'checking' | 'saved' | 'not_saved' | 'unavailable';

export const isPhoneOnlyName = (value?: string | null) => !value || /^\+?[\d\s().-]+$/.test(value.trim());

export const extractBusinessProfile = (profile: any) => {
  const value = profile?.data || profile?.businessProfile || profile || {};
  return {
    ...value,
    name: value.verifiedName || value.businessName || value.name || value.profileName || '',
  };
};

type UseContactPanelOptions = {
  activeConversation?: Conversation;
  isMock: boolean;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
};

export const useContactPanel = ({
  activeConversation,
  isMock,
  setConversations,
}: UseContactPanelOptions) => {
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<any | null>(null);
  const [loadingBusinessProfile, setLoadingBusinessProfile] = useState(false);
  const [savingGoogleContact, setSavingGoogleContact] = useState(false);
  const [googleContactFeedback, setGoogleContactFeedback] = useState('');
  const [googleContactStatus, setGoogleContactStatus] = useState<GoogleContactStatus>('checking');
  const [googleMatchedName, setGoogleMatchedName] = useState<string | null>(null);
  const [showGoogleContactForm, setShowGoogleContactForm] = useState(false);
  const [googleContactForm, setGoogleContactForm] = useState<GoogleContactForm>({
    name: '', phone: '', otherPhone: '', email: '', cpf: '', address: '', resourceName: '',
  });

  const activeConversationId = activeConversation?.id;
  const activeContactPhone = activeConversation?.contact.phone;
  const activeContactName = activeConversation?.contact.name;

  useEffect(() => {
    if (!activeConversation || isMock || !activeContactPhone || !isPhoneOnlyName(activeContactName)) return;
    let mounted = true;
    EvolutionApiService.fetchBusinessProfile(activeContactPhone).then((profile) => {
      if (!mounted || !profile) return;
      const normalizedProfile = extractBusinessProfile(profile);
      if (!normalizedProfile.name) return;
      setBusinessProfile(normalizedProfile);
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id && isPhoneOnlyName(conversation.contact.name) ? {
        ...conversation,
        contact: { ...conversation.contact, name: normalizedProfile.name },
      } : conversation));
    }).catch(() => {
      // O nome local continua válido quando a Evolution não disponibiliza o perfil.
    });
    return () => { mounted = false; };
  }, [activeContactName, activeContactPhone, activeConversationId, isMock, setConversations]);

  useEffect(() => {
    if (!showContactInfo || !activeConversation || !activeContactPhone) return;
    let mounted = true;
    setLoadingBusinessProfile(true);
    setBusinessProfile(null);
    setGoogleContactStatus('checking');
    setGoogleMatchedName(null);
    setGoogleContactFeedback('');

    const fallbackForm = {
      name: isPhoneOnlyName(activeContactName) ? '' : activeContactName || '',
      phone: activeContactPhone,
      otherPhone: '',
      email: '',
      cpf: '',
      address: '',
      resourceName: '',
    };

    apiRequest<{
      connected: boolean;
      saved: boolean;
      name: string | null;
      resourceName: string | null;
      email: string;
      cpf: string;
      address: string;
      otherPhone: string;
    }>('/api/google/contact-status', {
      method: 'POST',
      body: JSON.stringify({ phone: activeContactPhone }),
    }).then((status) => {
      if (!mounted) return;
      setGoogleContactStatus(!status.connected ? 'unavailable' : status.saved ? 'saved' : 'not_saved');
      setGoogleMatchedName(status.saved ? status.name : null);
      setGoogleContactForm({
        name: status.saved && status.name ? status.name : fallbackForm.name,
        phone: activeContactPhone,
        otherPhone: status.otherPhone || '',
        email: status.email || '',
        cpf: status.cpf || '',
        address: status.address || '',
        resourceName: status.resourceName || '',
      });
      if (status.saved && status.name) {
        setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
          ...conversation,
          contact: { ...conversation.contact, name: status.name || conversation.contact.name },
        } : conversation));
      }
    }).catch(() => {
      if (!mounted) return;
      setGoogleContactStatus('unavailable');
      setGoogleContactForm(fallbackForm);
    });

    EvolutionApiService.fetchBusinessProfile(activeContactPhone)
      .then((profile) => {
        if (!mounted || !profile) return;
        const normalizedProfile = extractBusinessProfile(profile);
        setBusinessProfile(normalizedProfile);
        if (normalizedProfile.name && isPhoneOnlyName(activeContactName)) {
          setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
            ...conversation,
            contact: { ...conversation.contact, name: normalizedProfile.name },
          } : conversation));
        }
      })
      .catch(() => undefined)
      .finally(() => { if (mounted) setLoadingBusinessProfile(false); });

    return () => {
      mounted = false;
      setShowGoogleContactForm(false);
    };
  }, [activeContactName, activeContactPhone, activeConversationId, showContactInfo, setConversations]);

  const openGoogleContactForm = useCallback(() => {
    if (!activeConversation) return;
    setGoogleContactFeedback('');
    setGoogleContactForm((current) => ({
      ...current,
      name: current.name || (googleMatchedName && !isPhoneOnlyName(googleMatchedName) ? googleMatchedName : ''),
      phone: activeConversation.contact.phone,
    }));
    setShowGoogleContactForm(true);
  }, [activeConversation, googleMatchedName]);

  const saveGoogleContactForm = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeConversation || !googleContactForm.name.trim() || !googleContactForm.phone.trim()) return;
    setSavingGoogleContact(true);
    setGoogleContactFeedback('');
    try {
      const result = await apiRequest<{ name: string; resourceName: string | null }>('/api/google/contact', {
        method: 'POST',
        body: JSON.stringify(googleContactForm),
      });
      setGoogleContactStatus('saved');
      setGoogleMatchedName(result.name);
      setShowGoogleContactForm(false);
      setGoogleContactFeedback('Contato salvo no Google Contacts.');
      setGoogleContactForm((current) => ({ ...current, resourceName: result.resourceName || current.resourceName }));
      setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
        ...conversation,
        contact: { ...conversation.contact, name: googleContactForm.name, phone: googleContactForm.phone },
      } : conversation));
    } catch (error) {
      setGoogleContactFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    } finally {
      setSavingGoogleContact(false);
    }
  }, [activeConversation, googleContactForm, setConversations]);

  return {
    showContactInfo,
    setShowContactInfo,
    businessProfile,
    loadingBusinessProfile,
    savingGoogleContact,
    googleContactFeedback,
    googleContactStatus,
    googleMatchedName,
    showGoogleContactForm,
    setShowGoogleContactForm,
    googleContactForm,
    setGoogleContactForm,
    openGoogleContactForm,
    saveGoogleContactForm,
  };
};
