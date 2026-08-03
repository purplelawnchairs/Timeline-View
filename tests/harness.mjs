let failures = 0;
let passes = 0;

export function group(name) {
	console.log(`\n-- ${name} --`);
}

export function check(name, fn) {
	try {
		fn();
		passes++;
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures++;
		console.log(`FAIL  ${name}\n      ${e.message}`);
	}
}

export function summary() {
	console.log(failures ? `\n${failures} failed, ${passes} passed\n` : `\n${passes} passed\n`);
	return failures;
}
