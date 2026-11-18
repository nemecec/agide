import { describe, expect, it } from 'vitest';
import { FakeCdp, sampleDescribeNode, samplePageTree } from './fakeCdp';
import { PageSession, UserMustType } from './PageSession';
import { StaleRefError } from './tables';

function session(cdp = new FakeCdp(), cookies: { value: string }[] = []) {
  cdp
    .on('Runtime.evaluate', (params: Record<string, unknown>) => {
      const expression = String(params['expression']);
      if (expression === 'location.href') return { result: { value: 'https://app.example/page' } };
      if (expression.includes('querySelectorAll')) return { result: { value: JSON.stringify(['hunter2']) } };
      return { result: { value: 'ok' } };
    })
    .on('Accessibility.getFullAXTree', samplePageTree())
    .on('DOM.describeNode', sampleDescribeNode);
  return { cdp, page: new PageSession({ transport: cdp, cookies: async () => cookies }) };
}

describe('read_page', () => {
  it('lists the tree with refs and shows no value for a password field', async () => {
    const { page } = session();
    await page.attach();
    const text = await page.readPage({});
    expect(text, 'heading and button').toContain('heading "Welcome"');
    expect(text, 'button ref').toMatch(/button "Save" \[ref_\d+\]/);
    expect(text, 'plain field value').toContain('value="Ada"');
    expect(text, 'password value hidden').not.toContain('hunter2');
    expect(text, 'password field still listed').toContain('textbox "Password"');
  });

  it('lists controls only with the interactive filter', async () => {
    const { page } = session();
    await page.attach();
    const text = await page.readPage({ filter: 'interactive' });
    expect(text, 'control').toContain('button "Save"');
    expect(text, 'heading left out').not.toContain('heading');
  });

  it('fails a ref as stale after the main frame navigates', async () => {
    const { cdp, page } = session();
    await page.attach();
    const ref = /button "Save" \[(ref_\d+)\]/.exec(await page.readPage({}))?.[1] ?? '';
    cdp.emit('Page.frameNavigated', { frame: { url: 'https://app.example/next' } });
    await expect(page.readPage({ refId: ref }), 'old ref after navigation').rejects.toBeInstanceOf(StaleRefError);
    cdp.emit('Page.frameNavigated', { frame: { parentId: 'x', url: 'https://ads.example' } });
    const fresh = /button "Save" \[(ref_\d+)\]/.exec(await page.readPage({}))?.[1] ?? '';
    cdp.emit('Page.frameNavigated', { frame: { parentId: 'x', url: 'https://ads.example/2' } });
    await expect(page.readPage({ refId: fresh }), 'a sub-frame navigation keeps refs').resolves.toContain('button');
  });

  it('truncates at a line boundary', async () => {
    const { page } = session();
    await page.attach();
    expect(await page.readPage({ maxChars: 100 }), 'cut output').toMatch(/^[\s\S]{0,200}$/);
  });
});

describe('find', () => {
  it('matches role, name and value literally and says so', async () => {
    const { page } = session();
    await page.attach();
    expect(await page.find('save'), 'name match, case-insensitive').toMatch(/button "Save" \[ref_\d+\]/);
    expect(await page.find('submit the form'), 'no semantic matching').toContain('matching is literal');
  });
});

describe('input', () => {
  it('clicks the center of a ref after scrolling it into view', async () => {
    const { cdp, page } = session();
    cdp.on('DOM.getContentQuads', { quads: [[10, 10, 30, 10, 30, 20, 10, 20]] });
    await page.attach();
    const ref = /button "Save" \[(ref_\d+)\]/.exec(await page.readPage({}))?.[1] ?? '';
    await page.click({ ref });
    expect(cdp.callsTo('DOM.scrollIntoViewIfNeeded').length, 'scrolled first').toBe(1);
    const pressed = cdp.callsTo('Input.dispatchMouseEvent').find((params) => params['type'] === 'mousePressed');
    expect(pressed, 'pressed at the center').toMatchObject({ x: 20, y: 15, button: 'left', clickCount: 1 });
  });

  it('refuses typing into a sensitive field and form input on one', async () => {
    const { cdp, page } = session();
    cdp.on('Runtime.evaluate', (params: Record<string, unknown>) => {
      const expression = String(params['expression']);
      if (expression === 'location.href') return { result: { value: 'https://app.example/' } };
      return { result: { value: JSON.stringify({ type: 'password', value: '', editable: true }) } };
    });
    await page.attach();
    await expect(page.type('secret'), 'type into password').rejects.toBeInstanceOf(UserMustType);
    expect(cdp.callsTo('Input.insertText').length, 'nothing was typed').toBe(0);
    const ref = /textbox "Password" \[(ref_\d+)\]/.exec(await page.readPage({}))?.[1] ?? '';
    await expect(page.formInput(ref, 'x'), 'form input on password').rejects.toThrow('the user must type this');
  });

  it('types with insertText and falls back to key events when the field value does not change', async () => {
    const { cdp, page } = session();
    cdp.on('Runtime.evaluate', (params: Record<string, unknown>) => {
      if (String(params['expression']) === 'location.href') return { result: { value: 'https://app.example/' } };
      return { result: { value: JSON.stringify({ type: 'text', value: 'same', editable: true }) } };
    });
    await page.attach();
    await page.type('ab');
    expect(cdp.callsTo('Input.insertText'), 'insert text first').toEqual([{ text: 'ab' }]);
    expect(cdp.callsTo('Input.dispatchKeyEvent').map((params) => params['text']), 'key events as fallback').toEqual(['a', 'b']);
  });

  it('sets a field through the native value setter', async () => {
    const { cdp, page } = session();
    cdp.on('DOM.resolveNode', { object: { objectId: 'o1' } }).on('Runtime.callFunctionOn', { result: { value: 'ok' } });
    await page.attach();
    const ref = /textbox "Name"[^\n]*\[(ref_\d+)\]/.exec(await page.readPage({}))?.[1] ?? '';
    await page.formInput(ref, 'Grace');
    expect(String(cdp.callsTo('Runtime.callFunctionOn')[0]?.['functionDeclaration']), 'setter and events').toMatch(/getOwnPropertyDescriptor[\s\S]*dispatchEvent\(new Event\('input'/);
  });
});

describe('screenshot', () => {
  it('captures the viewport at CSS pixels and states the frame size', async () => {
    const { cdp, page } = session();
    cdp.on('Page.getLayoutMetrics', { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } }).on('Page.captureScreenshot', { data: 'AAAA' });
    await page.attach();
    const shot = await page.screenshot({ scale: 0.5 });
    expect(cdp.callsTo('Page.captureScreenshot')[0], 'clip at scale').toMatchObject({ clip: { x: 0, y: 0, width: 800, height: 600, scale: 0.5 } });
    expect(shot, 'returned size shrinks, frame stays').toMatchObject({ width: 400, height: 300, frame: { width: 800, height: 600 } });
  });
});

describe('scripts and secrets', () => {
  it('masks cookie values and the values of sensitive fields in a script result', async () => {
    const { cdp, page } = session(new FakeCdp(), [{ value: 'cookievalue123' }]);
    cdp.on('Runtime.evaluate', (params: Record<string, unknown>) => {
      const expression = String(params['expression']);
      if (expression === 'location.href') return { result: { value: 'https://app.example/' } };
      if (expression.includes('querySelectorAll')) return { result: { value: JSON.stringify(['hunter2']) } };
      return { result: { value: 'cookie=cookievalue123 password=hunter2 name=Ada' } };
    });
    await page.attach();
    const text = await page.evaluate('document.cookie');
    expect(text, 'cookie and password masked, rest kept').toBe('cookie=[cookie] password=[sensitive field] name=Ada');
  });

  it('passes the sensitive field names as data, so a name with a slash or a quote cannot break the lookup', async () => {
    const cdp = new FakeCdp();
    cdp.on('Runtime.evaluate', (params: Record<string, unknown>) => {
      const expression = String(params['expression']);
      if (expression === 'location.href') return { result: { value: 'https://app.example/' } };
      if (expression.includes('querySelectorAll')) return { result: { value: JSON.stringify(['s3cret']) } };
      return { result: { value: 'value s3cret' } };
    });
    const page = new PageSession({ transport: cdp, sensitiveNames: ['Pay/ment', `it's`] });
    await page.attach();
    expect(await page.maskSecrets('value s3cret'), 'field value masked').toBe('value [sensitive field]');
    const lookup = String(cdp.callsTo('Runtime.evaluate').map((call) => (call as { expression: string }).expression).find((expression) => expression.includes('querySelectorAll')));
    expect(lookup, 'names as a JSON array').toContain(`["pay/ment","it's"]`);
    expect(lookup, 'no regex literal built from the names').not.toContain('/pay/ment');
  });

  it('runs the script with replMode and surfaces an exception as an error', async () => {
    const { cdp, page } = session();
    await page.attach();
    cdp.on('Runtime.evaluate', (params: Record<string, unknown>) => {
      if (String(params['expression']) === 'location.href') return { result: { value: 'https://app.example/' } };
      return { exceptionDetails: { text: 'boom', exception: { description: 'ReferenceError: x' } } };
    });
    await expect(page.evaluate('x'), 'exception').rejects.toThrow('ReferenceError: x');
    expect(cdp.callsTo('Runtime.evaluate').at(-1), 'replMode and awaitPromise').toMatchObject({ replMode: true, awaitPromise: true, returnByValue: true });
  });
});

describe('console, network and dialogs', () => {
  it('keeps console messages of the current domain, redacts network URLs and clears the network buffer on another domain', async () => {
    const { cdp, page } = session();
    await page.attach();
    cdp.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'bad thing' }], timestamp: 1 });
    cdp.emit('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://app.example/api?token=abc&q=1', method: 'GET' } });
    cdp.emit('Network.responseReceived', { requestId: '1', response: { status: 200 } });
    expect(page.readConsole({}), 'console text').toContain('[error] bad thing');
    expect(page.readConsole({ onlyErrors: true, pattern: 'nothing' }), 'filter').not.toContain('bad thing');
    const network = page.readNetwork({});
    expect(network, 'status shown').toContain('GET https://app.example/api?token=REDACTED&q=1 200');
    expect(network, 'secret hidden').not.toContain('abc');
    cdp.emit('Page.frameNavigated', { frame: { url: 'https://other.example/' } });
    expect(page.readNetwork({}), 'cleared after another domain').not.toContain('app.example/api');
    expect(page.readConsole({}), 'console of the old domain not shown').not.toContain('bad thing');
  });

  it('keeps a ring buffer of 1000 entries', async () => {
    const { cdp, page } = session();
    await page.attach();
    for (let i = 0; i < 1200; i++) cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: `m${i}` }] });
    const all = page.readConsole({ limit: 1000 });
    expect(all, 'oldest dropped').not.toContain('m0\n');
    expect(all, 'newest kept').toContain('m1199');
  });

  it('refuses tools while a dialog is open and names its text', async () => {
    const { cdp, page } = session();
    await page.attach();
    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete everything?' });
    await expect(page.pageText(), 'tool during dialog').rejects.toThrow('a confirm dialog is open with text "Delete everything?"; the user must answer it');
    cdp.emit('Page.javascriptDialogClosed');
    await expect(page.pageText(), 'after the dialog closed').resolves.toBeDefined();
  });
});

describe('navigation', () => {
  it('waits for the load event and reports the final URL, or the error text', async () => {
    const { cdp, page } = session();
    cdp.on('Page.navigate', () => {
      setTimeout(() => cdp.emit('Page.loadEventFired'), 5);
      return {};
    });
    cdp.on('Runtime.evaluate', () => ({ result: { value: JSON.stringify({ url: 'https://app.example/next', title: 'Next' }) } }));
    await page.attach();
    expect(await page.navigate('https://app.example/next'), 'loaded').toEqual({ url: 'https://app.example/next', title: 'Next' });
    cdp.on('Page.navigate', { errorText: 'net::ERR_NAME_NOT_RESOLVED' });
    expect((await page.navigate('https://nope.invalid/')).error, 'error text').toBe('net::ERR_NAME_NOT_RESOLVED');
  });
});
