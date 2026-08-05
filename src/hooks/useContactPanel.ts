import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../services/api';
import { EvolutionApiService } from '../services/evolutionApi';
import { Conversation } from '../types';

export type GoogleContactForm = {
  name: string;
  phone: string;
  otherPhone: string;
  otherPhones: string;
  email: string;
  emails: string;
  cpf: string;
  address: string;
  addresses: string;
  birthday: string;
  nickname: string;
  company: string;
  jobTitle: string;
  occupation: string;
  relations: string;
  events: string;
  customFields: string;
  website: string;
  notes: string;
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
  rememberContactName?: (phone: string, name: string) => void;
};

export const useContactPanel = ({
  activeConversation,
  isMock,
  setConversations,
  rememberContactName,
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
    name: '', phone: '', otherPhone: '', otherPhones: '', email: '', emails: '', cpf: '', address: '',
    birthday: '', nickname: '', company: '', jobTitle: '', occupation: '', relations: '', events: '', customFields: '', website: '', notes: '', addresses: '', resourceName: '',
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
  }, [activeContactPhone, activeConversationId, isMock, setConversations]);

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
      otherPhones: '',
      email: '',
      emails: '',
      cpf: '',
      address: '',
      addresses: '',
      birthday: '',
      nickname: '',
      company: '',
      jobTitle: '',
      occupation: '',
      relations: '',
      events: '',
      customFields: '',
      website: '',
      notes: '',
      resourceName: '',
    };

    let statusSettled = false;
    const statusTimeout = window.setTimeout(() => {
      if (!mounted || statusSettled) return;
      statusSettled = true;
      setGoogleContactStatus('unavailable');
      setGoogleContactFeedback('A verificação do Google demorou mais que o esperado. Você ainda pode tentar novamente.');
      setGoogleContactForm(fallbackForm);
    }, 8_000);

    apiRequest<{
      connected: boolean;
      saved: boolean;
      name: string | null;
      resourceName: string | null;
      email: string;
      cpf: string;
      address: string;
      addresses?: string[];
      otherPhone: string;
      otherPhones?: string[];
      emails?: string[];
      birthday?: string;
      nickname?: string;
      company?: string;
      jobTitle?: string;
      occupation?: string;
      relations?: string;
      events?: string;
      customFields?: string;
      website?: string;
      notes?: string;
    }>('/api/google/contact-status', {
      method: 'POST',
      body: JSON.stringify({ phone: activeContactPhone }),
    }).then((status) => {
      if (!mounted || statusSettled) return;
      statusSettled = true;
      window.clearTimeout(statusTimeout);
      setGoogleContactStatus(!status.connected ? 'unavailable' : status.saved ? 'saved' : 'not_saved');
      setGoogleMatchedName(status.saved ? status.name : null);
      setGoogleContactForm({
        name: status.saved && status.name ? status.name : fallbackForm.name,
        phone: activeContactPhone,
        otherPhone: status.otherPhone || '',
        otherPhones: Array.isArray(status.otherPhones) ? status.otherPhones.join(', ') : status.otherPhone || '',
        email: status.email || '',
        emails: Array.isArray(status.emails) ? status.emails.slice(1).join(', ') : '',
        cpf: status.cpf || '',
        address: status.address || '',
        addresses: Array.isArray(status.addresses) ? status.addresses.join('\n') : status.address || '',
        birthday: status.birthday || '',
        nickname: status.nickname || '',
        company: status.company || '',
        jobTitle: status.jobTitle || '',
        occupation: status.occupation || '',
        relations: status.relations || '',
        events: status.events || '',
        customFields: status.customFields || '',
        website: status.website || '',
        notes: status.notes || '',
        resourceName: status.resourceName || '',
      });
      if (status.saved && status.name) {
        rememberContactName?.(activeContactPhone, status.name);
        setConversations((previous) => previous.map((conversation) => conversation.id === activeConversation.id ? {
          ...conversation,
          contact: { ...conversation.contact, name: status.name || conversation.contact.name },
        } : conversation));
      }
    }).catch(() => {
      if (!mounted || statusSettled) return;
      statusSettled = true;
      window.clearTimeout(statusTimeout);
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
      window.clearTimeout(statusTimeout);
      setShowGoogleContactForm(false);
    };
  }, [activeContactPhone, activeConversationId, rememberContactName, showContactInfo, setConversations]);

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
      rememberContactName?.(googleContactForm.phone, googleContactForm.name);
    } catch (error) {
      setGoogleContactFeedback(error instanceof Error ? error.message : 'Não foi possível salvar o contato');
    } finally {
      setSavingGoogleContact(false);
    }
  }, [activeConversation, googleContactForm, rememberContactName, setConversations]);

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
