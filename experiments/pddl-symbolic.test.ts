import { describe, expect, test } from 'bun:test';
import { effect, predicate } from './domain-model';
import { applySymbolicFacts } from './pddl';
import type { LearnedActionSchema } from './schemas';

describe('applySymbolicFacts (current semantics)', () => {
    test('item_removed clears has_item (Priority 3 delete semantics)', () => {
        const facts = new Set<string>(['has_item:raw_shrimps', 'near_loc:range']);
        const removeRaw: LearnedActionSchema = {
            id: 'dummy_consume',
            name: 'Consume raw',
            parameters: [],
            preconditions: [predicate('has_item', { item: 'Raw shrimps', count: 1 })],
            effects: [effect('item_removed', { item: 'Raw shrimps', count: 1 })],
            negativeEvidence: [],
        };
        const next = applySymbolicFacts(facts, removeRaw);
        expect(next.has('has_item:raw_shrimps')).toBe(false);
    });

    test('item_added adds has_item and item_gained facts', () => {
        const facts = new Set<string>(['near_loc:range']);
        const cook: LearnedActionSchema = {
            id: 'dummy_cook',
            name: 'Cook',
            parameters: [],
            preconditions: [],
            effects: [effect('item_added', { item: 'Shrimps', count: 1 })],
            negativeEvidence: [],
        };
        const next = applySymbolicFacts(facts, cook);
        expect(next.has('has_item:shrimps')).toBe(true);
        expect(next.has('item_gained:shrimps')).toBe(true);
    });
});
