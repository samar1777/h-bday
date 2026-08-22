"""
WhatsApp Birthday Message Automation using PyWhatKit
---------------------------------------------------
Prerequisites:
1. Install pywhatkit:
   pip install pywhatkit

2. Be logged into WhatsApp Web (web.whatsapp.com) in your default browser.
3. Keep your screen unlocked and browser accessible when scheduled time arrives.
"""

import datetime
import os
import time
import pywhatkit


def send_instant_birthday_wish(phone_number: str, name: str, custom_message: str = None, wait_time: int = 15):
    """
    Sends an instant birthday wish to a specific phone number.
    
    :param phone_number: Receiver's phone number with country code (e.g., "+919876543210")
    :param name: Name of the birthday person
    :param custom_message: Optional custom message string
    :param wait_time: Seconds to wait for WhatsApp Web to load
    """
    if custom_message is None:
        message = (
            f"🎉🎂 Happy Birthday, {name}! 🎂🎉\n\n"
            f"Wishing you a fantastic day filled with joy, laughter, and success! "
            f"May all your dreams come true this year! 🥳✨"
        )
    else:
        message = custom_message

    print(f"\n[*] Target: {name} ({phone_number})")
    print(f"[*] Opening WhatsApp Web in default browser...")
    print(f"[*] Waiting {wait_time}s for chat to load before sending...")
    
    pywhatkit.sendwhatmsg_instantly(
        phone_no=phone_number,
        message=message,
        wait_time=wait_time,
        tab_close=True,
        close_time=3
    )
    print(f"[✓] Birthday message dispatched successfully to {name}!\n")


def schedule_birthday_wish(phone_number: str, name: str, hour: int, minute: int, custom_message: str = None, wait_time: int = 15):
    """
    Schedules a birthday wish at a specific hour and minute (24-hour format).
    Example: 00:01 for midnight birthday surprise.
    
    :param phone_number: Receiver's phone number with country code (e.g., "+919876543210")
    :param name: Name of the birthday person
    :param hour: Hour in 24-hour format (0-23, e.g., 0 for 12 AM midnight)
    :param minute: Minute (0-59, e.g., 0 for 12:00 AM)
    :param custom_message: Optional custom message string
    :param wait_time: Seconds to wait for WhatsApp Web to load
    """
    if custom_message is None:
        message = (
            f"🎂 Happy Birthday, {name}! 🎈✨\n\n"
            f"Wishing you a year ahead full of happiness, health, and great achievements! 🥂🎉"
        )
    else:
        message = custom_message

    print(f"\n[*] Scheduling birthday wish for {name} ({phone_number}) at {hour:02d}:{minute:02d}...")
    print("[*] Note: Keep your computer active and screen unlocked at the scheduled time.")
    
    pywhatkit.sendwhatmsg(
        phone_no=phone_number,
        message=message,
        time_hour=hour,
        time_min=minute,
        wait_time=wait_time,
        tab_close=True,
        close_time=3
    )
    print(f"[✓] Scheduled message configured successfully for {name}!\n")


def send_birthday_image(phone_number: str, image_path: str, caption: str = "🎉 Happy Birthday! 🎂", wait_time: int = 15):
    """
    Sends a birthday greeting image with a caption.
    
    :param phone_number: Receiver's phone number with country code (e.g., "+919876543210")
    :param image_path: Absolute or relative path to the image file (.jpg, .png)
    :param caption: Caption to accompany the image
    """
    if not os.path.exists(image_path):
        print(f"[!] Error: Image file '{image_path}' not found.")
        return

    print(f"\n[*] Sending birthday image to {phone_number}...")
    pywhatkit.sendwhats_image(
        receiver=phone_number,
        img_path=image_path,
        caption=caption,
        wait_time=wait_time,
        tab_close=True,
        close_time=3
    )
    print(f"[✓] Birthday image sent successfully!\n")


def check_and_send_todays_birthdays(birthday_list: list[dict]):
    """
    Checks today's date against a list of contacts and sends wishes to anyone celebrating today.
    
    :param birthday_list: List of dicts with 'name', 'phone', and 'dob' (format: 'MM-DD')
    """
    today = datetime.datetime.now().strftime("%m-%d")
    print(f"\n[*] Checking birthdays for today ({today})...")

    found = False
    for contact in birthday_list:
        if contact.get("dob") == today:
            found = True
            print(f"[!] Today is {contact['name']}'s birthday!")
            send_instant_birthday_wish(contact["phone"], contact["name"])
            time.sleep(10)  # Brief pause between multiple sends

    if not found:
        print("[*] No birthdays found for today in the contact list.")


def main():
    print("=" * 55)
    print("   🎂 WhatsApp Birthday Messenger (PyWhatKit) 🎂")
    print("=" * 55)
    print("Important: Ensure you are logged into WhatsApp Web in your default browser.\n")
    
    print("Choose an option:")
    print("  1. Send an Instant Birthday Wish (Test Run)")
    print("  2. Schedule a Birthday Wish (e.g., Midnight 00:00)")
    print("  3. Schedule a Test Wish for 2 Minutes from Now")
    print("  4. Check Today's Birthdays from Contact List")
    print("  5. Exit")
    print("-" * 55)

    choice = input("Enter your choice (1-5): ").strip()

    if choice == "1":
        phone = input("\nEnter recipient phone number with country code (e.g. +919876543210): ").strip()
        if not phone.startswith("+"):
            print("[!] Warning: Phone number must include country code (e.g., +1..., +91...).")
            phone = "+" + phone
        name = input("Enter recipient name (default: Friend): ").strip() or "Friend"
        msg = input("Enter custom message (or press Enter for default birthday wish): ").strip() or None
        
        print("\nStarting instant send in 3 seconds. Switch to your browser if needed...")
        time.sleep(3)
        send_instant_birthday_wish(phone, name, msg)

    elif choice == "2":
        phone = input("\nEnter recipient phone number with country code (e.g. +919876543210): ").strip()
        name = input("Enter recipient name (default: Friend): ").strip() or "Friend"
        hour = int(input("Enter Hour (0-23, e.g., 0 for midnight): ").strip())
        minute = int(input("Enter Minute (0-59): ").strip())
        msg = input("Enter custom message (or press Enter for default): ").strip() or None
        schedule_birthday_wish(phone, name, hour, minute, msg)

    elif choice == "3":
        now = datetime.datetime.now()
        target_time = now + datetime.timedelta(minutes=2)
        print(f"\nCurrent time: {now.strftime('%H:%M:%S')}")
        print(f"Target test time: {target_time.strftime('%H:%M')} (in 2 minutes)")
        
        phone = input("\nEnter recipient phone number with country code (e.g. +919876543210): ").strip()
        name = input("Enter recipient name (default: Test Friend): ").strip() or "Test Friend"
        
        schedule_birthday_wish(
            phone_number=phone,
            name=name,
            hour=target_time.hour,
            minute=target_time.minute,
            custom_message=f"🎉 Test Birthday Message sent via PyWhatKit at {target_time.strftime('%H:%M')}! 🚀"
        )

    elif choice == "4":
        sample_contacts = [
            {"name": "Alice", "phone": "+1234567890", "dob": datetime.datetime.now().strftime("%m-%d")},
            {"name": "Bob", "phone": "+1987654321", "dob": "12-25"},
        ]
        print("\nSample Contacts List:")
        for c in sample_contacts:
            print(f" - {c['name']} ({c['phone']}) - Birthday: {c['dob']}")
        check_and_send_todays_birthdays(sample_contacts)

    elif choice == "5":
        print("Exiting. Have a great day!")
    else:
        print("[!] Invalid option selected.")


if __name__ == "__main__":
    main()
