# 005 — Разделить открытие шторки, клавиатуру и обратную связь

- **Status**: TODO
- **Commit**: `e9d98b5`
- **Severity**: HIGH
- **Category**: Purpose & frequency, Performance, Accessibility, Cohesion
- **Estimated scope**: `frontend/script.js`, `frontend/path-support.js`, `frontend/path-support.css`, `frontend/path-motion.js`; точечные CSS/markup для фокуса и reduced motion, проверки на устройстве.
- **Рабочий каталог**: `C:/Users/Sinon/OneDrive/Рабочий стол/Claude-Cowork/disbit3`.

## Проблема

При открытии шторки приложение сразу фокусирует первый input. Это подтверждено на Galaxy A22, Android 13, WebView 155: после открытия формы создания обещания без ввода пользователя `dumpsys input_method` показал `mInputShown=true`. Снимок `release-artifacts/galaxy-a22-perf-keyboard.png` зафиксировал клавиатуру и ограниченное место для формы, preview и липких действий.

Причина находится в `frontend/script.js:3790–3798`:

```js
function openSheet(id) {
  const el = document.getElementById(id);
  // Finish an outgoing sheet before opening its successor; no overlapping forms.
  document.querySelectorAll('.sheet-overlay[hidden]').forEach(overlay => overlay.getAnimations({subtree:true}).forEach(animation => { try { animation.finish(); } catch {} }));
  el.inert = false;
  pathSheetFocus.delete(id); pathSheetFocus.set(id, document.activeElement);
  el.hidden = false;
  if (id === 'add-overlay') { document.getElementById('habit-form-error').hidden = true; updateHabitForm(); }
  queueMicrotask(() => { if (!el.hidden && !el.contains(document.activeElement)) el.querySelector('input:not([disabled]), button:not([disabled])')?.focus(); });
}
```

Одновременно запускается действующий transition шторки из `frontend/path-support.css:35–39`:

```css
.sheet { animation:none; transform:translateY(0); opacity:1; transition:transform var(--motion-ui) var(--ease-out),opacity var(--motion-ui) var(--ease-out); }
.sheet-overlay { opacity:1; transition:opacity var(--motion-ui) var(--ease-out),display var(--motion-ui) allow-discrete; }
.sheet-overlay[hidden] { pointer-events:none; opacity:0; }
.sheet-overlay[hidden] .sheet { transform:translateY(16px); opacity:0; }
@starting-style { .sheet-overlay:not([hidden]) .sheet { transform:translateY(16px); opacity:0; } dialog[open]:not(#completion-dialog) { opacity:0; transform:scale(.96); } }
```

Получаются два независимых движения: вход панели и изменение viewport из-за клавиатуры. Это не нужно маскировать удлинением анимации.

Второй подтверждённый дефект — reduced motion не охватывает новое WAAPI удерживающей кнопки. `frontend/path-motion.js:137–142` всегда запускает движущуюся заливку:

```js
function start() {
  if (!active || button.disabled || timer) return;
  button.classList.add('is-holding');
  fill = document.createElement('span'); fill.className = 'hold-fill'; fill.setAttribute('aria-hidden', 'true'); button.append(fill);
  progress = fill.animate([{transform: 'scaleX(0)'}, {transform: 'scaleX(1)'}], {duration: 1000, easing: 'linear', fill: 'forwards'});
  timer = setTimeout(commit, 1000);
}
```

`frontend/path-support.js:20–26` завершает лишь те анимации, которые уже существуют в момент применения настройки:

```js
function applyMotion() {
  document.documentElement.dataset.motion = reducedMotion() ? 'reduce' : 'full';
  const select = document.getElementById('set-motion');
  if (select) select.value = settings.motion === 'reduce' ? 'reduce' : 'system';
  const hint = document.getElementById('motion-hint');
  if (hint) hint.textContent = reducedMotion() ? 'Движение уменьшено. Отметки, прогресс и результаты сохраняются.' : 'Короткие переходы. Уменьшение движения в системе всегда имеет приоритет.';
  if (reducedMotion()) document.getAnimations().forEach(a => { try { a.finish(); } catch { a.cancel(); } });
}
```

Глобальные CSS `animation:none!important` и `transition:none!important` не выключают новый вызов `Element.animate()` после этого.

Кандидаты для сравнения на устройстве, без заранее назначенного виновника:

- `frontend/style.css:2243–2247`: полноэкранная `.sheet-overlay` сохраняет `backdrop-filter:blur(3px)`; `path-ui.css:109` меняет фон, но не снимает filter.
- `frontend/path-ui.css:137,155`: dock имеет blur `24px`, а на coarse pointer — `10px`. Это уже уменьшено; Glass Light является утверждённой визуальной частью проекта.

В исходном native gfxinfo прогоне на A22 выполнены 3 серии по 12 переключений вкладок: медианные значения длительности кадра в сериях лежали в диапазоне `17–22ms`, p95 — `48/73/81ms`. Это сведения native gfxinfo, **не FPS и не INP**. Без WebView/Perfetto trace эти значения не доказывают, что виноват blur, JavaScript или конкретный экран.

## Целевой результат

### Открытие, закрытие и клавиатура

- Touch/coarse pointer: открытие формы показывает панель и переносит доступный фокус на её заголовок/контейнер, не открывая клавиатуру. Клавиатура появляется только после касания поля пользователем.
- Клавиатурный сценарий: фокус остаётся внутри панели, первый доступный контрол достижим Tab; движение отключено существующей `data-input="keyboard"` политикой.
- Все программные focus используют `{preventScroll:true}`; они не запускают отдельную прокрутку страницы.
- Сохранить `180ms` для входа/выхода шторки, смещение `16px`, `cubic-bezier(0.23,1,0.32,1)`, opacity `0→1`. Новое открытие/закрытие должно быть прерываемым; бизнес-действие не ждёт конца transition.
- Close немедленно отключает взаимодействие с исходящей панелью (`inert`/pointer events), сохраняет черновик там, где это уже предусмотрено, и возвращает фокус без прокрутки. Не ждать 180ms, чтобы разрешить следующую навигацию.

### Нажатия и удержание

- Обычное нажатие: существующий `--motion-press:140ms`, transform/opacity и явное :active. При reduced motion сохраняется цвет/видимое состояние, пространственное движение отсутствует.
- Удержание подтверждения всегда длится **1000ms**. Это продуктовая защита, а не тормоз интерфейса; не сокращать её для улучшения метрик.
- При обычном движении разрешена текущая линейная заливка `scaleX(0)→scaleX(1)` за `1000ms`.
- При reduced motion заливка не движется: показать статическое состояние удержания, например полную неподвижную заливку с текущей прозрачностью `.22`, и сохранить доступную подсказку. Таймер и возможность отмены те же.
- Подтверждение запускает только отдельный timer. `animation.finished`, `finish()`, `cancel()` и переключение reduced motion не выполняют действие.

### Политика движения и эффекты

Сохранить единственные общие токены `frontend/path-support.css:2`:

```css
--motion-press: 140ms;
--motion-ui: 180ms;
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
```

Частые основные вкладки остаются мгновенными: `frontend/path-support.css:34` уже содержит `.screen.active { animation:none; }`. Не возвращать старый fadeUp из `style.css:232`. Если после выполнения бюджетов производительности тест пользователями докажет пользу мягкой смены содержания, допускается отдельный эксперимент с opacity не дольше `125ms`, без transform всего экрана, без блокировки тапа и только для pointer-ввода. Это не обязательный этап и не замена исправлению рендера.

Для blur нужны сравнимые A/B измерения. Решение об изменении Glass Light принимать после данных; автоматически удалять утверждённый эффект нельзя.

## Соглашения проекта

- `frontend/path-support.js:185–186` записывает `document.documentElement.dataset.input` как `keyboard` или `pointer`; использовать эту существующую модель, а не отдельный конфликтующий глобальный обработчик.
- Системный приоритет движения уже заложен в `reducedMotion()` (`path-support.js:17–18`) и `motionReduced()` (`path-motion.js:8–10`). Не создавать третье определение.
- `closeSheet()` уже сохраняет черновик, использует `inert`, восстанавливает фокус и защищает сохранение формы (`script.js:3800–3813`). Эти гарантии сохранить.
- `openSheet()` заканчивает исходящую скрытую панель, чтобы не накладывать формы (`script.js:3792–3793`); не отменять переходы вслепую у всех элементов документа.
- Действующий Light Glass на dock: фон `var(--glass)`, blur на touch `10px saturate(120%)`, fallback `var(--glass-solid)` и reduced transparency/contrast в `path-ui.css:191–195`.

## Подшаги реализации

1. **Зафиксировать baseline.** Повторить на A22 открытие «Создать» → «Обещание» без касания полей. Снять экран и `adb shell dumpsys input_method`; записать, что клавиатура показана автоматически. Для сравнения открыть те же панели с короткой и длинной формой. Использовать тестовый/локальный аккаунт и не сохранять обещания.
2. **Сделать явную стратегию фокуса в `openSheet()`.** Определять touch-сценарий через coarse pointer с учётом текущего `dataset.input`. Для touch выбрать `.sheet-title`/`h2`, установить `tabindex=-1`, если его нет, и вызвать `focus({preventScroll:true})`. Если заголовка нет — выбрать сам `.sheet` с `tabindex=-1`. На desktop pointer можно сохранить первый контрол, но всегда с preventScroll. На keyboard переносить фокус внутрь панели без анимации и обеспечить последовательность Tab.
3. **Не привязывать открытие клавиатуры к таймеру.** Не заменять microtask на `setTimeout(180)` с фокусом input: это только отложит автоматический скачок. Открытие клавиатуры следует за пользовательским касанием поля, а не за окончанием перехода.
4. **Сохранить фокус при быстрой смене панелей.** Callback фокуса должен проверять, что панель всё ещё открыта, не inert и является актуальной панелью. При «открыть → закрыть → открыть другую» ни input закрытой формы, ни фон не перехватывают фокус. Return focus в close выполняется только если его не заменило более новое открытие.
5. **Проверить sticky actions и viewport.** После ручного открытия клавиатуры форма прокручивается внутри нужного контейнера, активный input и кнопки не перекрываются. Существующие safe areas, `100dvh`, `--kb-h` и скрытие dock сохраняются. Не добавлять layout-анимацию высоты панели/viewport.
6. **Уточнить работу held feedback.** В `enhanceHoldButton.start()` перед созданием WAAPI проверить `motionReduced()` и способ ввода. В reduce не создавать transform-анимацию; оставить статический fill/state. Независимо от ветки timer запускается на `1000ms`. При pointerup/pointercancel/lostcapture/blur/hidden cancel по-прежнему отменяет timer и заливку.
7. **Обработать смену настройки во время удержания.** При включении reduced motion движущаяся заливка останавливается/становится статической, но не подтверждает операцию и не меняет remaining timer. При отпускании до 1000ms действие не выполняется. Не использовать глобальный `finish()` как путь подтверждения. Существующее разделение commit и анимации — обязательная гарантия.
8. **Проверить общий reduced motion.** Для CSS и WAAPI отдельно покрыть настройки до запуска эффекта и изменение настройки во время эффекта. Включить wheel, settings stack, theme reveal, hold, toast, cord, завершение марафона. У каждого эффекта есть видимое конечное состояние и доступная обратная связь.
9. **Провести A/B для полноэкранного blur.** В тестовом сеансе сравнить неизменённый blur `3px` у `.sheet-overlay` и вариант `backdrop-filter:none; -webkit-backdrop-filter:none` с тем же фоном `rgb(4 10 20 / .72)`. Выполнить по 10 одинаковых открытий/закрытий с прогревом, одинаковым DOM, сетью и состоянием клавиатуры. Снять WebView trace/Perfetto, отделить JS, layout, paint и composite. Не делать вывод по одному накопленному счётчику gfxinfo.
10. **Отдельно провести A/B dock.** На одной и той же длинной странице сравнить blur `10px saturate(120%)` и непрозрачную Light Glass-подложку `var(--glass-solid)` с прежними границей и внутренним бликом. Не менять одновременно blur, размеры, тени и DOM. Сохранить визуальное одобрение владельца и измерения в отчёте. Оставить текущий эффект, если значимого выигрыша нет.
11. **Проверить совместимость transitions.** На поддерживаемом Android/WebView и WebKit проверить `@starting-style`, discrete display/overlay transition. При отсутствии поддержки обеспечивать мгновенное корректное состояние, focus и pointer-events; не эмулировать паузами и не удерживать пользователя на экране. Прогрессивный эффект не должен быть условием работоспособности формы.
12. **Собрать единый результат.** Записать подтверждённые дефекты, числа до/после, вариант blur, который прошёл сравнение, и ограничения. При недостатке trace отметить гипотезу открытой; не приписывать всё GPU и не обещать конкретный множитель ускорения.

## Границы

- Не менять структуру навигации, денежные правила, сохранение черновиков, обработчики создания/удаления/пруфа и количество бесплатных пропусков.
- Не сокращать `1000ms` удержания и не делать бизнес-действие зависимым от успешности или завершения анимации.
- Не анимировать весь экран при каждом переключении вкладки; текущая мгновенная навигация — сознательное решение.
- Не сокращать шаг путешественника `700ms` автоматически: это редкий сценарий результата с отдельной повествовательной задачей.
- Не включать blur в общие transition и не анимировать layout: width/height/top/left/margin/padding.
- Не добавлять библиотеку, постоянный rAF, общий запрет всех нажатий на время эффекта или искусственную задержку ответа сервера ради анимации.
- Не удалять Glass Light без A/B и визуальной приёмки. Измерение — обязательный этап, исход эксперимента заранее не задан.
- Не менять настройки реального телефона навсегда: если для записи менялись параметры разработчика/сети/движения, восстановить их после теста.
- Этот план не подтверждает поддержку системных областей Android 15–16 или физического iPhone; эти устройства проверяются отдельно.
- Если исходные точки кода не совпадают с commit, сначала обновить план под текущее состояние, не применять изменения вслепую.

## Проверка

**Механическая проверка после реализации:**

```powershell
node --check frontend/script.js
node --check frontend/path-support.js
node --check frontend/path-motion.js
git diff --check
npm test
node scripts/check-release.mjs
```

Ожидание: существующие проверки проходят, native release использует HTTPS и локальные assets. Если меняется только механизм focus, не добавлять тесты на буквальное наличие строки CSS: проверять результат для пользователя.

**Браузер, изолированные сеансы:**

- Desktop `1280×900`, mobile `360×800`, WebKit mobile. Проверить «Создать обещание», «Создать марафон», детали операции, login, удаление/архив, колесо выбора.
- Touch: первый экран панели виден без focus в input и без scroll jump. Keyboard: фокус внутри панели, Tab/Shift+Tab и Escape работают; после закрытия фокус возвращается к открывшей кнопке.
- 20 быстрых open/close и смена панелей: не остаются открытые невидимые hit-target, focus не возвращается в закрытый input, модалки не перекрывают друг друга.
- Reduced motion включён заранее: ни новый hold, ни wheel/theme/stack не запускают пространственную WAAPI. Состояние нажатия/ошибки/успеха видно.
- Во время удержания: release до 1000ms отменяет действие; достижение 1000ms выполняет его один раз; смена reduced motion/visibility и finish анимации не подтверждают действие.

**Galaxy A22:**

1. На разблокированном телефоне открыть создание обещания без ввода. `mInputShown=false` до касания input; заголовок и действия доступны. После касания поля клавиатура открывается штатно.
2. Повторить с коротким и длинным содержимым, с полем у нижнего края; убедиться, что sticky actions и dock не перекрывают активное поле.
3. Сделать видеозапись и trace одинаковых 10 открытий/закрытий до/после. Отделить задержку первого отображения от времени входа `180ms`.
4. В DevTools замедлить анимации до 10%: панель движется один раз, клавиатура не открывается сама, повторное закрытие перенацеливает transition.
5. Провести blur A/B по шагам 9–10 и приложить результаты; не выдавать native frame-duration percentiles за INP/FPS.

**Готово, когда:** на A22 клавиатура не появляется при открытии формы без касания, положение панели и focus устойчивы, все ветки hold сохраняют защитный интервал 1000ms и отмену, reduced motion покрывает вновь запускаемые WAAPI, частые вкладки остаются мгновенными, а любое изменение Glass Light подкреплено отдельным измерением и визуальной приёмкой.
