import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities } from '../src/htmlEntities.js';

test('entità con e senza punto e virgola', () => {
  assert.equal(decodeEntities('Attivit&agrave; in corso W.O.'), 'Attività in corso W.O.');
  // I vecchi encoder omettono spesso il `;`: è il caso visto sul campo.
  assert.equal(decodeEntities('Attivit&agrave in corso W.O.'), 'Attività in corso W.O.');
  assert.equal(decodeEntities('perch&eacute;&nbsp;s&igrave;'), 'perché sì');
});

test('maiuscole e casi particolari', () => {
  assert.equal(decodeEntities('&Egrave; cos&igrave;'), 'È così');
  assert.equal(decodeEntities('&AElig;'), 'Æ');
  assert.equal(decodeEntities('&ETH;&THORN;'), 'ÐÞ');
  // La maiuscola di ß sarebbe "SS", due caratteri: si resta sulla minuscola.
  assert.equal(decodeEntities('&Szlig;'), 'ß');
  assert.equal(decodeEntities('&dagger;&Dagger;'), '†‡');
});

test('riferimenti numerici decimali ed esadecimali', () => {
  assert.equal(decodeEntities('&#224;&#232;'), 'àè');
  assert.equal(decodeEntities('&#xE0;&#Xe8;'), 'àè');
  assert.equal(decodeEntities('&#8364; 12,50'), '€ 12,50');
  // Fuori range o surrogati: lasciati com'erano.
  assert.equal(decodeEntities('&#0;'), '&#0;');
  assert.equal(decodeEntities('&#55296;'), '&#55296;');
});

test('lascia intatto ciò che non è un’entità', () => {
  assert.equal(decodeEntities('R&D reparto'), 'R&D reparto');
  assert.equal(decodeEntities('&notizie'), '&notizie');
  assert.equal(decodeEntities('a & b'), 'a & b');
  assert.equal(decodeEntities('WHERE x = 1 AND y &gt 2'), 'WHERE x = 1 AND y > 2');
  assert.equal(decodeEntities('&&amp;&'), '&&&');
});

test('valori senza & e non stringa passano invariati', () => {
  const s = 'nessuna entita qui';
  assert.equal(decodeEntities(s), s);
  assert.equal(decodeEntities(null), null);
  assert.equal(decodeEntities(42), 42);
});
