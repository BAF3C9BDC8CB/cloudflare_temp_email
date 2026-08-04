import { Context } from 'hono'

import i18n from '../i18n';
import { generatePublicToken } from '../public_api/token';

const MAX_TOKEN_ATTEMPTS = 5;

const insertNewToken = async (
	c: Context<HonoCustomType>,
	addressId: number
): Promise<string> => {
	for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
		const token = generatePublicToken();
		try {
			const { success } = await c.env.DB.prepare(
				'INSERT INTO address_public_link (address_id, token) VALUES (?, ?)'
			).bind(addressId, token).run();
			if (!success) throw new Error('insert failed');
			return token;
		} catch (error) {
			if ((error as Error).message?.includes('UNIQUE')) continue;
			throw error;
		}
	}
	throw new Error('failed to generate a unique token');
};

const getAddressPayload = (c: Context<HonoCustomType>) => c.get('jwtPayload');

const createPublicLink = async (c: Context<HonoCustomType>) => {
	const msgs = i18n.getMessagesbyContext(c);
	const { address, address_id: addressId } = getAddressPayload(c);
	if (!address || !addressId) return c.text(msgs.InvalidAddressTokenMsg, 400);
	const dbAddressId = await c.env.DB.prepare(
		'SELECT id FROM address WHERE id = ?'
	).bind(addressId).first('id');
	if (!dbAddressId) return c.text(msgs.InvalidAddressMsg, 400);
	await c.env.DB.prepare(
		'DELETE FROM address_public_link WHERE address_id = ?'
	).bind(addressId).run();
	return c.json({ token: await insertNewToken(c, addressId) });
};

const getPublicLink = async (c: Context<HonoCustomType>) => {
	const msgs = i18n.getMessagesbyContext(c);
	const { address, address_id: addressId } = getAddressPayload(c);
	if (!address || !addressId) return c.text(msgs.InvalidAddressTokenMsg, 400);
	const token = await c.env.DB.prepare(
		'SELECT token FROM address_public_link WHERE address_id = ?'
	).bind(addressId).first<string>('token');
	return c.json({ token: token ?? null });
};

const revokePublicLink = async (c: Context<HonoCustomType>) => {
	const msgs = i18n.getMessagesbyContext(c);
	const { address, address_id: addressId } = getAddressPayload(c);
	if (!address || !addressId) return c.text(msgs.InvalidAddressTokenMsg, 400);
	await c.env.DB.prepare(
		'DELETE FROM address_public_link WHERE address_id = ?'
	).bind(addressId).run();
	return c.json({ success: true });
};

export default { createPublicLink, getPublicLink, revokePublicLink };
