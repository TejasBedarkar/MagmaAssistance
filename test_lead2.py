from ERP.erp_client import ERPClient

def main():
    try:
        client = ERPClient()
        data = {"first_name": "John Doe", "company_name": "Tata Motors"}
        result = client.create_doc("Lead", data)
        print("Success:", result)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
