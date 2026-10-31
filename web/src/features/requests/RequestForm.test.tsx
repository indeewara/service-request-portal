import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestForm } from './RequestForm';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const createRequest = vi.fn();
vi.mock('./actions', () => ({
  createRequest: (...args: unknown[]) => createRequest(...args),
  getUploadTarget: vi.fn(),
  completeUpload: vi.fn(),
}));

const png = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

function setup() {
  const user = userEvent.setup({ applyAccept: false }); // let wrong types through so validation sees them
  render(<RequestForm />);
  const submit = () => user.click(screen.getByRole('button', { name: 'Send request' }));
  return { user, submit };
}

beforeEach(() => {
  push.mockReset();
  createRequest.mockReset();
});

describe('RequestForm validation', () => {
  it('lists every missing field in a summary that screen readers announce', async () => {
    const { submit } = setup();
    await submit();

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('There is a problem');
    expect(summary).toHaveTextContent('Category: Choose a category');
    expect(summary).toHaveTextContent('Order number: Enter the order number');
    expect(summary).toHaveTextContent('Description: Describe the problem');
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('marks invalid fields and links each to its error message', async () => {
    const { submit } = setup();
    await submit();

    const order = screen.getByLabelText('Order number');
    expect(order).toHaveAttribute('aria-invalid', 'true');
    // The hint and the error are both read out with the field.
    expect(order).toHaveAccessibleDescription(
      'On your delivery note, for example SO-10234. Enter the order number',
    );
    expect(screen.getByRole('link', { name: 'Order number: Enter the order number' })).toHaveAttribute(
      'href',
      '#orderNumber',
    );
  });

  it('moves focus to the error summary', async () => {
    const { submit } = setup();
    await submit();
    await new Promise((r) => requestAnimationFrame(r));
    expect(screen.getByRole('alert').parentElement).toHaveFocus();
  });

  it('treats whitespace-only text as empty', async () => {
    const { user, submit } = setup();
    await user.type(screen.getByLabelText('Order number'), '   ');
    await user.type(screen.getByLabelText('Description'), '   ');
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the order number');
    expect(screen.getByRole('alert')).toHaveTextContent('Describe the problem');
  });

  it('rejects a description over 2000 characters', async () => {
    const { user, submit } = setup();
    const description = screen.getByLabelText('Description');
    await user.click(description);
    await user.paste('x'.repeat(2001));
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Description must be 2000 characters or fewer');
  });

  it('rejects files that are not JPEG or PNG', async () => {
    const { user, submit } = setup();
    await user.upload(
      screen.getByLabelText('Photos (optional)'),
      new File(['GIF89a'], 'cat.gif', { type: 'image/gif' }),
    );
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Photos: cat.gif is not a JPEG or PNG image');
  });

  it('rejects photos over 5 MB', async () => {
    const { user, submit } = setup();
    await user.upload(screen.getByLabelText('Photos (optional)'), png('big.png', 5 * 1024 * 1024 + 1));
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Photos: big.png is larger than 5 MB');
  });

  it('rejects more than 5 photos', async () => {
    const { user, submit } = setup();
    await user.upload(
      screen.getByLabelText('Photos (optional)'),
      [1, 2, 3, 4, 5, 6].map((n) => png(`p${n}.png`)),
    );
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Photos: Choose up to 5 photos');
  });

  it('sends trimmed values when the form is valid', async () => {
    createRequest.mockResolvedValue({ ok: true, id: 'req-1' });
    const { user, submit } = setup();
    await user.selectOptions(screen.getByLabelText('Category'), 'WRONG_ITEM');
    await user.type(screen.getByLabelText('Order number'), '  SO-123  ');
    await user.type(screen.getByLabelText('Description'), ' Wrong tiles ');
    await submit();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(createRequest).toHaveBeenCalledWith({
      category: 'WRONG_ITEM',
      orderNumber: 'SO-123',
      description: 'Wrong tiles',
    });
    expect(push).toHaveBeenCalledWith('/requests/req-1');
  });

  it("shows the API's unknown-order error on the order number field", async () => {
    const message = "We couldn't find this order number. Check it and try again.";
    createRequest.mockResolvedValue({ ok: false, error: message, fieldErrors: { orderNumber: message } });
    const { user, submit } = setup();
    await user.selectOptions(screen.getByLabelText('Category'), 'OTHER');
    await user.type(screen.getByLabelText('Order number'), 'XX-1');
    await user.type(screen.getByLabelText('Description'), 'Missing pallet');
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(`Order number: ${message}`);
    expect(screen.getByLabelText('Order number')).toHaveAttribute('aria-invalid', 'true');
  });
});
