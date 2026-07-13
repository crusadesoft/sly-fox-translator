/*
 * Ukrainian word-family stemmer.
 *
 * Derived from ukrstemmer 0.1.0 by Constantin Titarenko, which is ported
 * from Drupal's ukstemmer project. Licensed under GPL-2.0-only.
 * Source: https://github.com/titarenko/ukrstemmer
 */
(() => {
  const VOWEL = /[аеиоуюяіїє]/u;
  const PERFECTIVE_GROUND = /((ив|ивши|ившись|ыв|ывши|ывшись(в|вши|вшись)))$/u;
  const REFLEXIVE = /(с[яьи])$/u;
  const ADJECTIVE = /(ими|ій|ий|а|е|ова|ове|ів|є|їй|єє|еє|я|ім|ем|им|ім|их|іх|ою|йми|іми|у|ю|ого|ому|ої)$/u;
  const PARTICIPLE = /(ий|ого|ому|им|ім|а|ій|у|ою|ій|і|их|йми|их)$/u;
  const VERB = /(сь|ся|ив|ать|ять|у|ю|ав|али|учи|ячи|вши|ши|е|ме|ати|яти|є)$/u;
  const NOUN = /(а|ев|ов|е|ями|ами|еи|и|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я|і|ові|ї|ею|єю|ою|є|еві|ем|єм|ів|їв|'ю)$/u;
  const RV = /^(.*?[аеиоуюяіїє])(.*)$/u;
  const DERIVATIONAL = /[^аеиоуюяіїє][аеиоуюяіїє]+[^аеиоуюяіїє]+[аеиоуюяіїє].*сть?$/u;

  function stemUkrainianWord(input) {
    if (input == null || !String(input).length) {
      return input;
    }

    const word = String(input).toLocaleLowerCase("uk");
    const parts = word.match(RV);
    if (!parts) {
      return word;
    }

    const start = parts[1];
    let ending = parts[2];
    if (!ending) {
      return word;
    }

    let next = ending.replace(PERFECTIVE_GROUND, "");
    if (next === ending) {
      ending = ending.replace(REFLEXIVE, "");
      next = ending.replace(ADJECTIVE, "");
      if (next === ending) {
        ending = ending.replace(PARTICIPLE, "");
      } else {
        ending = next;
        next = ending.replace(VERB, "");
        ending = next === ending ? ending.replace(NOUN, "") : next;
      }
    } else {
      ending = next;
    }

    ending = ending.replace(/и$/u, "");
    if (DERIVATIONAL.test(ending)) {
      ending = ending.replace(/ость?$/u, "");
    }

    next = ending.replace(/ь$/u, "");
    if (next === ending) {
      ending = ending.replace(/ейше?/u, "").replace(/нн$/u, "н");
    } else {
      ending = next;
    }

    return `${start}${ending}`;
  }

  globalThis.LWRUkrainianStemmer = stemUkrainianWord;
})();
