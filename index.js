import fetch from "node-fetch";
import mysql from "mysql";
import dotenv from "dotenv";
import schoolMappings from "./schoolMapping.json" assert { type: "json" };
dotenv.config();

const con = mysql.createConnection({
	host: process.env.HOST,
	user: process.env.USER,
	password: process.env.PASSWORD,
	database: "hooscheds",
});

const findSchool = (abbreviation) => {
	for (const [key, value] of Object.entries(schoolMappings)) {
		if (value.includes(abbreviation)) return key;
	}
	return "College of Arts & Sciences";
};

const executeQuery = async (query, args, successMessage, failureMessage) => {
	try {
		const result = await new Promise((resolve, reject) => {
			con.query(query, args, function (error, results, fields) {
				if (error) reject(error);
				if (fields) resolve(fields);
				if (results) resolve(results);
			});
		});
		console.log(successMessage, result);
	} catch (err) {
		console.error(
			err.code && err.message
				? `${failureMessage} ${err.code}, ${err.message}`
				: err
		);
	}
};

(async () => {
	con.connect((err) =>
		err ? console.error(err.stack) : console.log("Successfully connected!")
	);

	const res = await fetch("https://api.devhub.virginia.edu/v1/courses");
	const data = await res.json();

	// 8756 courses with number < 5000, 177 departments

	const filteredCourses = data.class_schedules.records.filter(
		(row) => row[1] < 5000
	);
	// .slice(0, 3); // just a few rows to start

	// Delete all existing Department / Course / Section data:
	await executeQuery(
		"DELETE FROM Department;",
		[],
		"Deleted existing departments",
		"failed to delete existing departments"
	);
	await executeQuery(
		"DELETE FROM Section;",
		[],
		"Deleted existing section",
		"failed to delete existing section"
	);
	await executeQuery(
		"DELETE FROM course_department;",
		[],
		"Deleted existing course_department",
		"failed to delete existing course_department"
	);
	await executeQuery(
		"DELETE FROM Course;",
		[],
		"Deleted existing courses",
		"failed to delete existing courses"
	);

	// insert all Department, Course, and Section Data
	for (const row of filteredCourses) {
		const [
			subject,
			catalog_number,
			class_section,
			class_number,
			class_title,
			class_topic_formal_desc,
			instructor,
			enrollment_capacity,
			meeting_days,
			meeting_time_start,
			meeting_time_end,
			term,
			term_desc,
		] = row;

		// department
		executeQuery(
			`INSERT INTO Department(
         dept_id,
         school_name) VALUES (?, ?);`,
			[subject, findSchool(subject)],
			"Success: inserted into Department",
			"Failure: did not insert into Department"
		);
		// course
		executeQuery(
			`INSERT INTO Course(
         course_id,
         course_name,
         term) VALUES (?, ?, ?);`,
			[`${subject} ${catalog_number}`, class_title, term_desc],
			"Success: inserted into Course",
			"Failure: did not insert into Course"
		);
		// course_department
		executeQuery(
			`INSERT INTO course_department(
         course_id,
         dept_id) VALUES ( ?, ?);`,
			[`${subject} ${catalog_number}`, subject],
			"Success: inserted into course_department",
			"Failure: did not insert into course_department"
		);
		// section
		executeQuery(
			`INSERT INTO Section(
         section_id,
         course_id,
         professor,
         location,
         start_time,
         end_time,
         meeting_dates,
         availability) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
			[
				class_section,
				`${subject} ${catalog_number}`,
				instructor,
				"In Person",
				meeting_time_start,
				meeting_time_end,
				meeting_days,
				"Open",
			],
			"Success: inserted into Section",
			"Failure: did not insert into Section"
		);
	}
	con.end((err) =>
		err ? console.error(err.stack) : console.log("terminated connection")
	);
})();
