import { Context, Hono } from 'hono'

import i18n from '../i18n';
import { handleMailListQuery } from '../common';
import { isValidPublicToken } from './token';

export const getAddressByPublicToken = async (
	c: Context<HonoCustomType>,
	token: string | null
): Promise<string | null> => {
	if (!token || !isValidPublicToken(token)) return null;
	const row = await c.env.DB.prepare(
		'SELECT a.name FROM address_public_link l JOIN address a ON a.id = l.address_id WHERE l.token = ?'
	).bind(token).first<{ name: string }>();
	return row?.name ?? null;
};

const listPublicMails = async (c: Context<HonoCustomType>) => {
	const msgs = i18n.getMessagesbyContext(c);
	const address = await getAddressByPublicToken(c, c.req.raw.headers.get('x-public-token'));
	if (!address) return c.text(msgs.PublicLinkNotFoundMsg, 404);
	const { limit, offset } = c.req.query();
	const response = await handleMailListQuery(
		c,
		'SELECT * FROM raw_mails WHERE address = ?',
		'SELECT count(*) as count FROM raw_mails WHERE address = ?',
		[address], limit, offset
	);
	if (response.status !== 200) return response;
	const body = await response.json() as { results: Record<string, unknown>[], count: number };
	return c.json({ ...body, address });
};

export const api = new Hono<HonoCustomType>();
api.get('/public_api/mails', listPublicMails);

export default api;
