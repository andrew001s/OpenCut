import { NextResponse } from "next/server";

function disabled() {
	return NextResponse.json(
		{ error: "Authentication is disabled in this build" },
		{ status: 404 },
	);
}

export async function GET() {
	return disabled();
}

export async function POST() {
	return disabled();
}
