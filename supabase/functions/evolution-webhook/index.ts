import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://qekxqewrqtcmqmswoglh.supabase.co";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFla3hxZXdycXRjbXFtc3dvZ2xoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDkwNjgyMiwiZXhwIjoyMTAwNDgyODIyfQ.MKyr3ezUC5-ZcmzAUNcoifqK99a4H80U4wPqHbEr5E8";
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    console.log("[Evolution Webhook Body]:", JSON.stringify(body));

    const event = body.event || body.type;
    const data = body.data;

    if (event === "messages.upsert" || event === "MESSAGES_UPSERT" || event === "SEND_MESSAGE" || event === "messages.update" || event === "MESSAGES_UPDATE") {
      let msgObj = null;

      if (Array.isArray(data)) {
        msgObj = data[0];
      } else if (data?.key) {
        msgObj = data;
      } else if (data?.message) {
        msgObj = data.message;
      }

      if (!msgObj) {
        return new Response(JSON.stringify({ status: "ignored_no_message_structure" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const key = msgObj.key || {};
      const remoteJid = key.remoteJid || msgObj.remoteJid || "";
      
      if (!remoteJid || remoteJid.includes("@g.us") || remoteJid === "status@broadcast") {
        return new Response(JSON.stringify({ status: "ignored_group_or_broadcast", remoteJid }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const cleanPhone = remoteJid.split("@")[0];
      const fromMe = key.fromMe === true;
      const pushName = msgObj.pushName || body.sender?.split("@")[0] || cleanPhone;

      const messageContent =
        msgObj.message?.conversation ||
        msgObj.message?.extendedTextMessage?.text ||
        msgObj.message?.imageMessage?.caption ||
        msgObj.message?.videoMessage?.caption ||
        (msgObj.message?.audioMessage ? "[Áudio]" : null) ||
        (msgObj.message?.imageMessage ? "[Imagem]" : null) ||
        (msgObj.message?.documentMessage ? "[Documento]" : null) ||
        msgObj.text ||
        "[Mensagem]";

      // 1. Criar ou buscar Contato
      let contactId = null;
      const { data: existingContact } = await supabase
        .from("contacts")
        .select("id")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact, error: createContactErr } = await supabase
          .from("contacts")
          .insert({
            name: pushName,
            phone: cleanPhone,
          })
          .select("id")
          .single();

        if (!createContactErr && newContact) {
          contactId = newContact.id;
        }
      }

      if (!contactId) {
        return new Response(JSON.stringify({ error: "Could not create or find contact" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      // 2. Criar ou buscar Conversa
      let conversationId = null;
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id, unread_count")
        .eq("contact_id", contactId)
        .maybeSingle();

      const timestampISO = new Date().toISOString();

      if (existingConv) {
        conversationId = existingConv.id;
        const currentUnread = existingConv.unread_count || 0;

        await supabase
          .from("conversations")
          .update({
            last_message: messageContent,
            last_message_timestamp: timestampISO,
            unread_count: fromMe ? 0 : currentUnread + 1,
          })
          .eq("id", conversationId);
      } else {
        const { data: newConv, error: createConvErr } = await supabase
          .from("conversations")
          .insert({
            contact_id: contactId,
            status: "open",
            department: "Atendimento Geral",
            last_message: messageContent,
            last_message_timestamp: timestampISO,
            unread_count: fromMe ? 0 : 1,
          })
          .select("id")
          .single();

        if (!createConvErr && newConv) {
          conversationId = newConv.id;
        }
      }

      // 3. Salvar Mensagem
      if (conversationId) {
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender: fromMe ? "attendant" : "contact",
          sender_name: fromMe ? "Atendente" : pushName,
          content: messageContent,
          status: "read",
          is_internal_note: false,
          timestamp: timestampISO,
        });
      }

      return new Response(JSON.stringify({ status: "success", conversationId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ status: "ignored_event", event }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[Webhook Exception]:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
