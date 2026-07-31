/**
 * `Symbol.dispose` / `Symbol.asyncDispose` в тестовом реалме.
 *
 * Node определяет эти символы при бутстрапе процесса, но jest гоняет тесты
 * в отдельном vm-контексте, куда патч не доезжает. Хелперы `using` /
 * `await using`, которые эмитит ts-jest под `target: es2022`, читают их с
 * глобала своего реалма — без этого файла `await using app = …` падает
 * «Symbol.asyncDispose is not defined».
 *
 * Значения берутся регистровыми (`Symbol.for('nodejs.…')`) — те же, что у
 * самого Node, поэтому объекты, пришедшие из основного реалма, диспозятся
 * тем же символом.
 */

if (typeof Symbol.asyncDispose === 'undefined') {
  Object.defineProperty(Symbol, 'asyncDispose', {
    value: Symbol.for('nodejs.asyncDispose'),
  });
}

if (typeof Symbol.dispose === 'undefined') {
  Object.defineProperty(Symbol, 'dispose', {
    value: Symbol.for('nodejs.dispose'),
  });
}
