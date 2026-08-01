-- Script de Criação das Tabelas do Vitstock Hub para o Supabase
-- Execute este script no SQL Editor do seu Dashboard Supabase

-- Habilitar extensão para geração de UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

--------------------------------------------------------------------------------
-- 1. Tabela: profiles (Atendentes / Usuários do Sistema)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'attendant' CHECK (role IN ('admin', 'attendant')),
    online BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 2. Tabela: tags (Etiquetas de Organização)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 3. Tabela: contacts (Contatos / Clientes)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    avatar TEXT,
    email TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 4. Tabela de Relacionamento: contact_tags
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_tags (
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
);

--------------------------------------------------------------------------------
-- 5. Tabela: conversations (Conversas do Chat)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE NOT NULL,
    assigned_attendant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    department TEXT DEFAULT 'Geral',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
    last_message TEXT,
    last_message_timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    unread_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 6. Tabela: messages (Mensagens enviadas e recebidas)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender TEXT NOT NULL CHECK (sender IN ('contact', 'attendant', 'system')),
    sender_name TEXT,
    content TEXT NOT NULL,
    media_url TEXT,
    media_type TEXT CHECK (media_type IN ('image', 'audio', 'document')),
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    is_internal_note BOOLEAN DEFAULT false,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 7. Tabela: deals (Funil de Vendas / Negócios)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    value NUMERIC(10, 2) DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'novo' CHECK (stage IN ('novo', 'negociacao', 'proposta', 'fechado')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 8. Tabela de Relacionamento: deal_tags
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_tags (
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (deal_id, tag_id)
);

--------------------------------------------------------------------------------
-- 9. Tabela: campaigns (Campanhas de Disparo / Automação)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('group', 'contacts')),
    target_group_jid TEXT,
    target_group_name TEXT,
    image_url TEXT,
    caption TEXT NOT NULL,
    schedule_time TEXT NOT NULL,
    schedule_days TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- 10. Tabela: whatsapp_instances (Instâncias do WhatsApp / Evolution API)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'connecting', 'disconnected')),
    qr_code_url TEXT,
    profile_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

--------------------------------------------------------------------------------
-- Habilitar Row Level Security (RLS) e Políticas Básicas (Permissão de Acesso)
--------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso total para usuários autenticados e service_role
DO $$ 
DECLARE 
    t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Permitir Acesso Leitura e Escrita" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Permitir Acesso Leitura e Escrita" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;
