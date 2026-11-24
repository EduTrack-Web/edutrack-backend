/**
 * Vietnamese lunisolar conversion engine (UTC+7).
 *
 * Adapted from hnthap/lunar-calendar-api v0.3.0, a clean-room TypeScript
 * implementation of Jean Meeus' Astronomical Algorithms.
 * Copyright (c) 2026 Huynh Nhan Thap. Licensed under the MIT License; see
 * ../vendor/hnthap-lunar-calendar-api.LICENSE.txt.
 */

const SECONDS_TO_DAYS = 1 / 86_400
const VIETNAM_TIME_ZONE_OFFSET = 7

interface GregorianDate {
  year: number
  month: number
  day: number
  timeZoneOffset: number
}

interface GregorianTime extends GregorianDate {
  hour: number
  minute: number
  second: number
}

export interface EngineLunarDate {
  day: number
  month: number
  year: number
  isLeapMonth: boolean
  monthSize: number
}

const normalizeDegrees = (degrees: number): number => {
  const normalized = degrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

const sinDegrees = (degrees: number): number => Math.sin((degrees * Math.PI) / 180)

const getSunTrueLongitude = (julianDayDynamicTime: number): number => {
  const centuries = (julianDayDynamicTime - 2_451_545) / 36_525
  const centuriesSquared = centuries * centuries
  const meanLongitude = 280.46645 + 36_000.76983 * centuries + 0.0003032 * centuriesSquared
  const meanAnomaly =
    357.52910
    + 35_999.05030 * centuries
    + 0.0001559 * centuriesSquared
    - 0.00000048 * centuriesSquared * centuries
  const center =
    (1.914600 - 0.004817 * centuries - 0.000014 * centuriesSquared) * sinDegrees(meanAnomaly)
    + (0.019993 - 0.000101 * centuries) * sinDegrees(2 * meanAnomaly)
    + 0.000290 * sinDegrees(3 * meanAnomaly)

  return normalizeDegrees(meanLongitude + center)
}

const getNewMoonJulianDayDynamicTime = (lunationNumber: number): number => {
  const centuries = lunationNumber / 1236.85
  const centuriesSquared = centuries * centuries
  const centuriesCubed = centuriesSquared * centuries
  const centuriesFourth = centuriesCubed * centuries
  const eccentricity = 1 - 0.002516 * centuries - 0.0000074 * centuriesSquared
  const meanPhase =
    2_451_550.09765
    + 29.530588853 * lunationNumber
    + 0.0001337 * centuriesSquared
    - 0.000000150 * centuriesCubed
    + 0.00000000073 * centuriesFourth
  const sunMeanAnomaly =
    2.5534
    + 29.10535669 * lunationNumber
    - 0.0000218 * centuriesSquared
    - 0.00000011 * centuriesCubed
  const moonMeanAnomaly =
    201.5643
    + 385.81693528 * lunationNumber
    + 0.0107438 * centuriesSquared
    + 0.00001239 * centuriesCubed
    - 0.000000058 * centuriesFourth
  const moonArgumentOfLatitude =
    160.7108
    + 390.67050274 * lunationNumber
    - 0.0016341 * centuriesSquared
    - 0.00000227 * centuriesCubed
    + 0.000000011 * centuriesFourth
  const ascendingNodeLongitude =
    124.7746
    - 1.56375580 * lunationNumber
    + 0.0020691 * centuriesSquared
    + 0.00000215 * centuriesCubed
  const corrections =
    -0.40720 * sinDegrees(moonMeanAnomaly)
    + 0.17241 * eccentricity * sinDegrees(sunMeanAnomaly)
    + 0.01608 * sinDegrees(2 * moonMeanAnomaly)
    + 0.01039 * sinDegrees(2 * moonArgumentOfLatitude)
    + 0.00739 * eccentricity * sinDegrees(moonMeanAnomaly - sunMeanAnomaly)
    - 0.00514 * eccentricity * sinDegrees(moonMeanAnomaly + sunMeanAnomaly)
    + 0.00208 * eccentricity * eccentricity * sinDegrees(2 * sunMeanAnomaly)
    - 0.00111 * sinDegrees(moonMeanAnomaly - 2 * moonArgumentOfLatitude)
    - 0.00057 * sinDegrees(moonMeanAnomaly + 2 * moonArgumentOfLatitude)
    + 0.00056 * eccentricity * sinDegrees(2 * moonMeanAnomaly + sunMeanAnomaly)
    - 0.00042 * sinDegrees(3 * moonMeanAnomaly)
    + 0.00042 * eccentricity * sinDegrees(sunMeanAnomaly + 2 * moonArgumentOfLatitude)
    + 0.00038 * eccentricity * sinDegrees(sunMeanAnomaly - 2 * moonArgumentOfLatitude)
    - 0.00024 * eccentricity * sinDegrees(2 * moonMeanAnomaly - sunMeanAnomaly)
    - 0.00017 * sinDegrees(ascendingNodeLongitude)
    - 0.00007 * sinDegrees(moonMeanAnomaly + 2 * sunMeanAnomaly)
    + 0.00004 * sinDegrees(2 * moonMeanAnomaly - 2 * moonArgumentOfLatitude)
    + 0.00004 * sinDegrees(3 * sunMeanAnomaly)
    + 0.00003 * sinDegrees(moonMeanAnomaly + sunMeanAnomaly - 2 * moonArgumentOfLatitude)
    + 0.00003 * sinDegrees(2 * moonMeanAnomaly + 2 * moonArgumentOfLatitude)
    - 0.00003 * sinDegrees(moonMeanAnomaly + sunMeanAnomaly + 2 * moonArgumentOfLatitude)
    + 0.00003 * sinDegrees(moonMeanAnomaly - sunMeanAnomaly + 2 * moonArgumentOfLatitude)
    - 0.00002 * sinDegrees(moonMeanAnomaly - sunMeanAnomaly - 2 * moonArgumentOfLatitude)
    - 0.00002 * sinDegrees(3 * moonMeanAnomaly + sunMeanAnomaly)
    + 0.00002 * sinDegrees(4 * moonMeanAnomaly)
    + 0.000325 * sinDegrees(299.77 + 0.107408 * lunationNumber - 0.009173 * centuriesSquared)
    + 0.000165 * sinDegrees(251.88 + 0.016321 * lunationNumber)
    + 0.000164 * sinDegrees(251.83 + 26.651886 * lunationNumber)
    + 0.000126 * sinDegrees(349.42 + 36.412478 * lunationNumber)
    + 0.000110 * sinDegrees(84.66 + 18.206239 * lunationNumber)
    + 0.000062 * sinDegrees(141.74 + 53.303771 * lunationNumber)
    + 0.000060 * sinDegrees(207.14 + 2.453732 * lunationNumber)
    + 0.000056 * sinDegrees(154.84 + 7.306860 * lunationNumber)
    + 0.000047 * sinDegrees(34.52 + 27.261239 * lunationNumber)
    + 0.000042 * sinDegrees(207.19 + 0.121824 * lunationNumber)
    + 0.000040 * sinDegrees(291.34 + 1.844379 * lunationNumber)
    + 0.000037 * sinDegrees(161.72 + 24.198154 * lunationNumber)
    + 0.000035 * sinDegrees(239.56 + 25.513099 * lunationNumber)
    + 0.000023 * sinDegrees(331.55 + 3.592518 * lunationNumber)

  return meanPhase + corrections
}

const convertGregorianToJulianDay = (date: GregorianTime): number => {
  let year = date.year
  let month = date.month
  const fractionalDay =
    date.day
    + (date.hour - date.timeZoneOffset + (date.minute + date.second / 60) / 60) / 24

  if (month < 3) {
    year -= 1
    month += 12
  }

  const century = Math.floor(year / 100)
  const gregorianCorrection = 2 - century + Math.floor(century / 4)
  return (
    Math.floor(365.25 * (year + 4716))
    + Math.floor(30.6001 * (month + 1))
    + fractionalDay
    + gregorianCorrection
    - 1524.5
  )
}

const convertJulianDayToGregorian = (julianDay: number, timeZoneOffset: number): GregorianTime => {
  const localJulianDay = julianDay + timeZoneOffset / 24
  const integerPart = Math.floor(localJulianDay + 0.5)
  const fractionalPart = localJulianDay + 0.5 - integerPart
  const alpha = Math.floor((integerPart - 1_867_216.25) / 36_524.25)
  const correctedDay = integerPart + 1 + alpha - Math.floor(alpha / 4)
  const shiftedDay = correctedDay + 1524
  const yearFactor = Math.floor((shiftedDay - 122.1) / 365.25)
  const elapsedYearDays = Math.floor(365.25 * yearFactor)
  const monthFactor = Math.floor((shiftedDay - elapsedYearDays) / 30.6001)
  const month = monthFactor < 14 ? monthFactor - 1 : monthFactor - 13
  const year = month > 2 ? yearFactor - 4716 : yearFactor - 4715
  const dayWithFraction = shiftedDay - elapsedYearDays - Math.floor(30.6001 * monthFactor) + fractionalPart
  const day = Math.floor(dayWithFraction)
  const hourWithFraction = (dayWithFraction - day) * 24
  const hour = Math.floor(hourWithFraction)
  const minuteWithFraction = (hourWithFraction - hour) * 60
  const minute = Math.floor(minuteWithFraction)
  const second = Math.round((minuteWithFraction - minute) * 60)

  return { year, month, day, hour, minute, second, timeZoneOffset }
}

const getDeltaTimeSeconds = (julianDay: number): number =>
  -15 + ((julianDay - 2_382_148) * (julianDay - 2_382_148)) / 41_048_480

const getDeltaTimeSecondsFromDynamicTime = (dynamicJulianDay: number): number => {
  let universalJulianDay = dynamicJulianDay
  let previousUniversalJulianDay = 0
  let iterations = 0

  while (universalJulianDay !== previousUniversalJulianDay && iterations < 20) {
    previousUniversalJulianDay = universalJulianDay
    universalJulianDay = dynamicJulianDay - getDeltaTimeSeconds(universalJulianDay) * SECONDS_TO_DAYS
    iterations += 1
  }

  return getDeltaTimeSeconds(universalJulianDay)
}

const approximateLunationNumber = (date: GregorianTime): number => {
  const leapYearFactor = date.year % 400 === 0 || (date.year % 4 === 0 && date.year % 100 !== 0) ? 1 : 2
  const dayOfYear =
    Math.floor((275 * date.month) / 9)
    - leapYearFactor * Math.floor((date.month + 9) / 12)
    + date.day
    - 30
  const utcDayFraction =
    (date.hour - date.timeZoneOffset + (date.minute + date.second / 60) / 60) / 24

  return (
    ((dayOfYear - 1 + utcDayFraction) / (leapYearFactor === 1 ? 366 : 365))
    + date.year
    - 2000
  ) * 12.3685
}

const compareGregorianDates = (left: GregorianDate, right: GregorianDate): number => {
  if (left.year !== right.year) return left.year < right.year ? -1 : 1
  if (left.month !== right.month) return left.month < right.month ? -1 : 1
  if (left.day !== right.day) return left.day < right.day ? -1 : 1
  return 0
}

const getWinterSolsticeJulianDayDynamicTime = (
  year: number,
  timeZoneOffset: number,
): number => {
  let left = convertGregorianToJulianDay({
    year,
    month: 12,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    timeZoneOffset,
  })
  let right = left + 35
  let middle = (left + right) / 2

  for (let iteration = 0; iteration < 100; iteration += 1) {
    middle = (left + right) / 2
    const longitude = getSunTrueLongitude(middle)
    if (Math.abs(longitude - 270) < 1e-9) return middle
    if (longitude < 270) left = middle
    else right = middle
  }

  return middle
}

const getMonthElevenLunationNumber = (year: number, timeZoneOffset: number): number => {
  const solsticeDynamicTime = getWinterSolsticeJulianDayDynamicTime(year, timeZoneOffset)
  const solsticeDate = convertJulianDayToGregorian(
    solsticeDynamicTime - getDeltaTimeSeconds(solsticeDynamicTime) * SECONDS_TO_DAYS,
    timeZoneOffset,
  )
  const lunationNumber = Math.round(approximateLunationNumber(solsticeDate))
  const newMoonDynamicTime = getNewMoonJulianDayDynamicTime(lunationNumber)
  const newMoonDate = convertJulianDayToGregorian(
    newMoonDynamicTime - getDeltaTimeSeconds(newMoonDynamicTime) * SECONDS_TO_DAYS,
    timeZoneOffset,
  )

  return compareGregorianDates(newMoonDate, solsticeDate) > 0 ? lunationNumber - 1 : lunationNumber
}

const getLeapMonthLunationNumber = (
  currentYearMonthEleven: number,
  nextYearMonthEleven: number,
  timeZoneOffset: number,
): number | null => {
  if (nextYearMonthEleven - currentYearMonthEleven <= 12) return null

  for (let offset = 1; offset <= 12; offset += 1) {
    const currentDynamicTime = getNewMoonJulianDayDynamicTime(currentYearMonthEleven + offset)
    const nextDynamicTime = getNewMoonJulianDayDynamicTime(currentYearMonthEleven + offset + 1)
    const currentUniversalTime =
      currentDynamicTime - getDeltaTimeSecondsFromDynamicTime(currentDynamicTime) * SECONDS_TO_DAYS
    const nextUniversalTime =
      nextDynamicTime - getDeltaTimeSecondsFromDynamicTime(nextDynamicTime) * SECONDS_TO_DAYS
    const currentLocalDate = convertJulianDayToGregorian(currentUniversalTime, timeZoneOffset)
    const nextLocalDate = convertJulianDayToGregorian(nextUniversalTime, timeZoneOffset)
    const currentLocalMidnight = convertGregorianToJulianDay({
      ...currentLocalDate,
      hour: 0,
      minute: 0,
      second: 0,
    })
    const nextLocalMidnight = convertGregorianToJulianDay({
      ...nextLocalDate,
      hour: 0,
      minute: 0,
      second: 0,
    })
    const currentLongitude = getSunTrueLongitude(
      currentLocalMidnight + getDeltaTimeSeconds(currentLocalMidnight) * SECONDS_TO_DAYS,
    )
    const nextLongitude = getSunTrueLongitude(
      nextLocalMidnight + getDeltaTimeSeconds(nextLocalMidnight) * SECONDS_TO_DAYS,
    )

    if (Math.floor(currentLongitude / 30) === Math.floor(nextLongitude / 30)) {
      return currentYearMonthEleven + offset
    }
  }

  return null
}

const getLocalMidnightJulianDayForNewMoon = (
  lunationNumber: number,
  timeZoneOffset: number,
): number => {
  const dynamicTime = getNewMoonJulianDayDynamicTime(lunationNumber)
  const universalTime = dynamicTime - getDeltaTimeSecondsFromDynamicTime(dynamicTime) * SECONDS_TO_DAYS
  const localDate = convertJulianDayToGregorian(universalTime, timeZoneOffset)
  return convertGregorianToJulianDay({ ...localDate, hour: 0, minute: 0, second: 0 })
}

export const convertVietnameseSolarToLunar = (
  year: number,
  month: number,
  day: number,
  timeZoneOffset: number = VIETNAM_TIME_ZONE_OFFSET,
): EngineLunarDate => {
  const gregorianTime: GregorianTime = {
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZoneOffset,
  }
  const gregorianJulianDay = convertGregorianToJulianDay(gregorianTime)
  let targetLunationNumber = Math.round(approximateLunationNumber(gregorianTime))
  let monthStartJulianDay = getLocalMidnightJulianDayForNewMoon(targetLunationNumber, timeZoneOffset)
  let nextMonthStartJulianDay = getLocalMidnightJulianDayForNewMoon(targetLunationNumber + 1, timeZoneOffset)

  if (gregorianJulianDay < monthStartJulianDay) {
    targetLunationNumber -= 1
    nextMonthStartJulianDay = monthStartJulianDay
    monthStartJulianDay = getLocalMidnightJulianDayForNewMoon(targetLunationNumber, timeZoneOffset)
  } else if (gregorianJulianDay >= nextMonthStartJulianDay) {
    targetLunationNumber += 1
    monthStartJulianDay = nextMonthStartJulianDay
    nextMonthStartJulianDay = getLocalMidnightJulianDayForNewMoon(targetLunationNumber + 1, timeZoneOffset)
  }

  const thisYearMonthEleven = getMonthElevenLunationNumber(year, timeZoneOffset)
  const startsAfterThisYearMonthEleven = targetLunationNumber >= thisYearMonthEleven
  const startMonthEleven = startsAfterThisYearMonthEleven
    ? thisYearMonthEleven
    : getMonthElevenLunationNumber(year - 1, timeZoneOffset)
  const endMonthEleven = startsAfterThisYearMonthEleven
    ? getMonthElevenLunationNumber(year + 1, timeZoneOffset)
    : thisYearMonthEleven
  const leapMonthLunationNumber = getLeapMonthLunationNumber(startMonthEleven, endMonthEleven, timeZoneOffset)
  let lunarMonth = 11
  let lunarYear = startsAfterThisYearMonthEleven ? year : year - 1
  let isLeapMonth = false

  for (let lunation = startMonthEleven + 1; lunation <= targetLunationNumber; lunation += 1) {
    if (lunation === leapMonthLunationNumber) {
      isLeapMonth = true
    } else {
      isLeapMonth = false
      lunarMonth += 1
      if (lunarMonth === 13) {
        lunarMonth = 1
        lunarYear += 1
      }
    }
  }

  return {
    year: lunarYear,
    month: lunarMonth,
    day: gregorianJulianDay - monthStartJulianDay + 1,
    isLeapMonth,
    monthSize: nextMonthStartJulianDay - monthStartJulianDay,
  }
}
