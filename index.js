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

const parseTime = (timeString) => {
	const splitString = timeString.split(".");
	const [hourStr, minuteStr, ..._rest] = splitString;
	let hour = parseInt(hourStr);
	let timeOfDay = "AM";
	// cases: 12 am, 1-11 am, 12 pm, 1-11 pm; default is 1-11 am
	if (hour === 0) {
		hour = 12;
	} else if (hour === 12) {
		timeOfDay = "PM";
	} else if (hour > 12) {
		hour -= 12;
		timeOfDay = "PM";
	}
	return `${hour}:${minuteStr} ${timeOfDay}`;
};

const insertCourse = async (course) => {
	// const [
	// 	subject,
	// 	catalog_number,
	// 	class_section,
	// 	class_number,
	// 	class_title,
	// 	class_topic_formal_desc,
	// 	instructor,
	// 	enrollment_capacity,
	// 	meeting_days,
	// 	meeting_time_start,
	// 	meeting_time_end,
	// 	term,
	// 	term_desc,
	// ] = row;

	const {
		subject,
		catalog_number,
		description,
		course_section,
		instructor,
		meetings: uncleanMeetings,
		enrollment_available,
		enrollment_total,
	} = course;

	if (catalog_number >= 6000) return;

	const course_id = `${subject} ${catalog_number}`;
	const meetings =
		uncleanMeetings.length > 0
			? uncleanMeetings
			: [
					{
						days: "",
						start_time: "00.00.00.000000-05:00",
						end_time: "00.00.00.000000-05:00",
						facility_description: "No facility description",
					},
			  ];

	/* Department {
      dept_id: subject,
      school_name: findSchool(subject)
   } */
	// department
	await executeQuery(
		`INSERT INTO Department(
      dept_id,
      school_name) VALUES (?, ?);`,
		[subject, findSchool(subject)],
		"Success: inserted into Department",
		"Failure: did not insert into Department"
	);
	/* Course {
      course_id: course_id
      course_name: description
      term: Fall 2022
   } */
	// course
	await executeQuery(
		`INSERT INTO Course(
      course_id,
      course_name,
      term) VALUES (?, ?, ?);`,
		[course_id, description, "Fall 2022"],
		"Success: inserted into Course",
		"Failure: did not insert into Course"
	);

	/* course_department {
      course_id: course_id
      dept_id: subject
   } */
	// course_department
	await executeQuery(
		`INSERT INTO course_department(
      course_id,
      dept_id) VALUES ( ?, ?);`,
		[course_id, subject],
		"Success: inserted into course_department",
		"Failure: did not insert into course_department"
	);
	/* Section {
      section_id: course_section
      course_id: course_id
      professor: instructor.name
      location: meetings[0].facility_description
      start_time: parseTime(meetings[0].start_time)
      end_time: parseTime(meetings[0].end_time)
      meeting_dates: meetings[0].days
      availability: `${enrollment_available}/${enrollment_total}`
   } */
	// section
	await executeQuery(
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
			course_section,
			course_id,
			instructor.name,
			meetings[0].facility_description,
			parseTime(meetings[0].start_time),
			parseTime(meetings[0].end_time),
			meetings[0].days,
			`${enrollment_available}/${enrollment_total}`,
		],
		"Success: inserted into Section",
		`Failure: did not insert into Section; ${meetings[0].start_time}`
	);
};

const fetchDeptData = async (deptName) => {
	const res = await fetch(
		`http://luthers-list.herokuapp.com/api/dept/${deptName}`
	);
	const deptCourseData = (await res.json()).slice(0, 5);

	const coursePromises = [];
	for (const course of deptCourseData) {
		coursePromises.push(insertCourse(course));
	}
	return await Promise.allSettled(coursePromises);
};

(async () => {
	con.connect((err) =>
		err ? console.error(err.stack) : console.log("Successfully connected!")
	);

	// Delete all existing Department / Course / Section data:
	await executeQuery(
		"DELETE FROM course_department;",
		[],
		"Deleted existing course_department",
		"failed to delete existing course_department"
	);
	await executeQuery(
		"DELETE FROM section_schedule;",
		[],
		"Deleted existing section_schedule",
		"failed to delete existing section_schedules"
	);

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
		"DELETE FROM Course;",
		[],
		"Deleted existing courses",
		"failed to delete existing courses"
	);

	const res = await fetch("http://luthers-list.herokuapp.com/api/deptlist/");
	const deptData = await res.json();
	// console.log(deptData);

	const deptPromises = [];
	for (const subj of deptData) {
		deptPromises.push(fetchDeptData(subj.subject));
	}

	const deptPromiseResults = await Promise.allSettled(deptPromises);
	console.log(deptPromiseResults);
	con.end((err) =>
		err ? console.error(err.stack) : console.log("terminated connection")
	);
})();
