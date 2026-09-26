import { describe, it, expect } from 'vitest';
import { classifyCategory, classifyCategories } from './xtreamCategories';

describe('classifyCategory', () => {
  it('classifies obvious sports categories', () => {
    expect(classifyCategory('USA | SPORTS')).toBe('sports');
    expect(classifyCategory('UK: BT Sport')).toBe('sports');
    expect(classifyCategory('NFL GAME PASS')).toBe('sports');
  });

  it('classifies PPV/event categories as maybe-sports', () => {
    expect(classifyCategory('PPV EVENTS')).toBe('maybe-sports');
  });

  it('classifies unrelated categories as not-sports', () => {
    expect(classifyCategory('USA | ENTERTAINMENT')).toBe('not-sports');
    expect(classifyCategory('Kids')).toBe('not-sports');
  });

  it('respects admin overrides regardless of keywords', () => {
    expect(classifyCategory('USA | SPORTS', { 'usa | sports': 'not-sports' })).toBe('not-sports');
    expect(classifyCategory('Random Category', { 'random category': 'sports' })).toBe('sports');
  });
});

describe('classifyCategories', () => {
  it('splits included (sports + maybe-sports) from excluded (not-sports) and counts both', () => {
    const categories = [
      { category_id: '10', category_name: 'USA | SPORTS' },
      { category_id: '11', category_name: 'PPV EVENTS' },
      { category_id: '20', category_name: 'USA | ENTERTAINMENT' },
      { category_id: '21', category_name: 'Kids' },
    ];
    const { included, excluded } = classifyCategories(categories);
    expect(included.map((c) => c.categoryId)).toEqual(['10', '11']);
    expect(excluded.map((c) => c.categoryId)).toEqual(['20', '21']);
  });
});
