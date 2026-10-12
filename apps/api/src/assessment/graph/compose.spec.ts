import { listText } from './compose.js';

describe('listText', () => {
  it('joins short lists naturally', () => {
    expect(listText(['fever'])).toBe('fever');
    expect(listText(['sore throat', 'fever', 'cough'])).toBe('sore throat, fever and cough');
  });

  it('moves a label containing a comma to the end', () => {
    expect(listText(['swollen, tender neck glands', 'sore throat', 'fever'])).toBe('sore throat, fever and swollen, tender neck glands');
  });

  it('uses semicolons when several labels contain commas', () => {
    expect(listText(['fever', 'swollen, tender neck glands', 'red, watery eyes'])).toBe('fever; swollen, tender neck glands and red, watery eyes');
  });
});
