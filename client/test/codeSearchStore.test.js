import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store.js';
import { api } from '../src/api.js';

// La ricerca globale vive nello store (la barra laterale si apre e si chiude,
// i risultati devono restare): qui si prova la parte che non ha bisogno di un
// browser, cioè cosa viene chiesto al server e cosa si tiene della risposta.

const connected = () =>
  useStore.setState({
    selectedConnId: 'c1',
    active: { c1: { status: 'connected', currentSchema: 'HR' } },
    codeSearch: { ...useStore.getState().codeSearch, running: false, error: null, result: null },
  });

const empty = { objects: [], total: 0, objectCount: 0, truncated: false, elapsedMs: 5 };

test('i parametri arrivano al server nella forma che si aspetta', async () => {
  connected();
  let seen = null;
  api.searchCode = async (id, params) => ((seen = { id, params }), empty);

  useStore.setState({
    codeSearch: {
      ...useStore.getState().codeSearch,
      query: 'v_saldo',
      caseSensitive: true,
      wholeWord: false,
      regex: false,
      types: ['PROCEDURE', 'TRIGGER'],
      scope: 'one',
      owner: 'PAGHE',
    },
  });
  await useStore.getState().runCodeSearch();

  assert.equal(seen.id, 'c1');
  assert.equal(seen.params.q, 'v_saldo');
  assert.equal(seen.params.types, 'PROCEDURE,TRIGGER');
  assert.equal(seen.params.scope, 'one');
  assert.equal(seen.params.owner, 'PAGHE');
  assert.equal(seen.params.caseSensitive, '1');
  // Gli interruttori spenti restano stringhe vuote: la query string li salta.
  assert.equal(seen.params.wholeWord, '');
  assert.equal(seen.params.regex, '');
});

test('lo schema si manda solo quando l’ambito è «un solo schema»', async () => {
  connected();
  let seen = null;
  api.searchCode = async (id, params) => ((seen = params), empty);
  useStore.setState({
    codeSearch: { ...useStore.getState().codeSearch, query: 'x', scope: 'user', owner: 'PAGHE' },
  });
  await useStore.getState().runCodeSearch();
  assert.equal(seen.owner, '');
});

test('senza connessione attiva non si interroga nessuno', async () => {
  useStore.setState({
    selectedConnId: 'c1',
    active: {},
    codeSearch: { ...useStore.getState().codeSearch, query: 'x', result: null, error: null },
  });
  let called = false;
  api.searchCode = async () => ((called = true), empty);
  await useStore.getState().runCodeSearch();
  assert.equal(called, false);
  assert.match(useStore.getState().codeSearch.error, /Nessuna connessione/);
});

test('campo vuoto: nessuna richiesta', async () => {
  connected();
  let called = false;
  api.searchCode = async () => ((called = true), empty);
  useStore.setState({ codeSearch: { ...useStore.getState().codeSearch, query: '' } });
  await useStore.getState().runCodeSearch();
  assert.equal(called, false);
});

test('l’errore del server diventa messaggio, non risultato', async () => {
  connected();
  api.searchCode = async () => ({ error: 'ORA-12726: RE non valida' });
  useStore.setState({ codeSearch: { ...useStore.getState().codeSearch, query: '[' } });
  await useStore.getState().runCodeSearch();
  const cs = useStore.getState().codeSearch;
  assert.equal(cs.result, null);
  assert.match(cs.error, /ORA-12726/);
  assert.equal(cs.running, false);
});

test('la risposta di una ricerca superata non sovrascrive quella nuova', async () => {
  connected();
  const later = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));
  let call = 0;
  api.searchCode = async () => {
    call++;
    return call === 1
      ? later(40, { ...empty, total: 1, objects: [{ owner: 'HR', name: 'VECCHIA', type: 'PROCEDURE', matches: [] }] })
      : later(5, { ...empty, total: 2, objects: [{ owner: 'HR', name: 'NUOVA', type: 'PROCEDURE', matches: [] }] });
  };

  useStore.setState({ codeSearch: { ...useStore.getState().codeSearch, query: 'a' } });
  const slow = useStore.getState().runCodeSearch();
  useStore.setState({ codeSearch: { ...useStore.getState().codeSearch, query: 'b' } });
  const fast = useStore.getState().runCodeSearch();
  await Promise.all([slow, fast]);

  const { result } = useStore.getState().codeSearch;
  assert.equal(result.objects[0].name, 'NUOVA');
  assert.equal(result.connId, 'c1');
  assert.equal(result.spec.q, 'b'); // il risultato si porta dietro come è stato cercato
});

test('pulendo i risultati si scarta anche la risposta ancora in volo', async () => {
  connected();
  api.searchCode = async () => new Promise((r) => setTimeout(() => r({ ...empty, total: 3 }), 20));
  useStore.setState({ codeSearch: { ...useStore.getState().codeSearch, query: 'a' } });
  const p = useStore.getState().runCodeSearch();
  useStore.getState().clearCodeSearch();
  await p;
  assert.equal(useStore.getState().codeSearch.result, null);
});
