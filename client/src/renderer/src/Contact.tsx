/** Where to ask for help. Opens Telegram in the browser (links leave the app via shell.openExternal). */
export const SUPPORT_TG = 'i20620226357u';

export function Contact({ prefix = 'По вопросам пиши в Telegram' }: { prefix?: string }) {
  return (
    <p class="contact">
      {prefix}{' '}
      <a href={`https://t.me/${SUPPORT_TG}`} target="_blank" rel="noreferrer">
        @{SUPPORT_TG}
      </a>
    </p>
  );
}
