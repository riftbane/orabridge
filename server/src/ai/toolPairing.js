// Ogni `tool_use` dell'assistente deve avere il suo `tool_result`: se una
// chiamata resta scoperta (Stop a metà turno, approvazione mai data, riavvio
// del server) tutte le richieste successive vengono rifiutate dal provider e la
// sessione non risponde più.
//
// `sealMessages` chiude le chiamate rimaste in sospeso con un esito fittizio,
// inserito subito dopo il messaggio che le ha aperte — è la posizione che
// Anthropic pretende, e gli altri adattatori la accettano.
// Restituisce il nuovo elenco di messaggi, oppure null se non c'era niente da
// sistemare.

export function sealMessages(messages, reason) {
  const answered = new Set();
  for (const m of messages) {
    for (const b of m.content || []) if (b.type === 'tool_result') answered.add(b.toolUseId);
  }
  const patched = [];
  let changed = false;
  for (const m of messages) {
    patched.push(m);
    const orphans = (m.content || []).filter((b) => b.type === 'tool_use' && !answered.has(b.id));
    if (!orphans.length) continue;
    changed = true;
    patched.push({
      role: 'user',
      content: orphans.map((b) => ({
        type: 'tool_result',
        toolUseId: b.id,
        toolName: b.name,
        content: reason,
        isError: true,
      })),
    });
  }
  return changed ? patched : null;
}
